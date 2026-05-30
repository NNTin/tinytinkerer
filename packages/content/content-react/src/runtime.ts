import type {
  ContentNode,
  ContentNodeByType
} from '@tinytinkerer/content-core'

export type NodeRendererPluginRequirements = {
  readonly lazy?: boolean
  readonly clientOnly?: boolean
  readonly needsDom?: boolean
}

export type RuntimeExecutionPolicy = {
  readonly allowLazy?: boolean
  readonly allowClientOnly?: boolean
  readonly allowDom?: boolean
}

export type RenderContext<TResult> = {
  readonly renderBlock: (node: ContentNode) => TResult
  readonly isStreaming?: boolean
}

export type RenderNodeOptions = {
  readonly isStreaming?: boolean
}

export type RuntimeFailureReason =
  | 'noPlugin'
  | 'noMatch'
  | 'policyBlocked'
  | 'loadFailed'
  | 'renderFailed'

export interface NodeRendererPlugin<TType extends ContentNode['type'], TResult> {
  readonly id: string
  readonly nodeType: TType
  readonly priority?: number
  readonly requirements?: NodeRendererPluginRequirements
  matches?(node: ContentNodeByType[TType]): boolean
  load?(): Promise<void>
  render(node: ContentNodeByType[TType], ctx: RenderContext<TResult>): TResult
  fallback?(node: ContentNodeByType[TType], failure: RuntimeFailureContext<TResult>): TResult
}

export type AnyNodeRendererPlugin<TResult> = {
  [K in ContentNode['type']]: NodeRendererPlugin<K, TResult>
}[ContentNode['type']]

export type RuntimeFailureContext<TResult> = {
  readonly node: ContentNode
  readonly reason: RuntimeFailureReason
  readonly error?: unknown
  readonly plugin?: AnyNodeRendererPlugin<TResult>
  readonly candidates: readonly AnyNodeRendererPlugin<TResult>[]
}

export type RuntimeResolution<TResult> =
  | {
      readonly ok: true
      readonly plugin: AnyNodeRendererPlugin<TResult>
      readonly candidates: readonly AnyNodeRendererPlugin<TResult>[]
    }
  | ({
      readonly ok: false
    } & RuntimeFailureContext<TResult>)

export type RuntimeFallback<TResult> = (failure: RuntimeFailureContext<TResult>) => TResult

export type RuntimeWrapContext<TResult> = {
  readonly node: ContentNode
  readonly plugin: AnyNodeRendererPlugin<TResult>
  readonly fallback: (reason?: RuntimeFailureReason, error?: unknown) => TResult
}

export type RuntimeWrap<TResult> = (
  result: TResult,
  ctx: RuntimeWrapContext<TResult>
) => TResult

export type CreateContentRuntimeOptions<TResult> = {
  readonly fallback: RuntimeFallback<TResult>
  readonly wrap?: RuntimeWrap<TResult>
  readonly executionPolicy?: RuntimeExecutionPolicy
}

export interface ContentRuntime<TResult> {
  register<TType extends ContentNode['type']>(plugin: NodeRendererPlugin<TType, TResult>): void
  resolve(node: ContentNode): RuntimeResolution<TResult>
  renderNode(node: ContentNode, options?: RenderNodeOptions): TResult
  prepareNode(node: ContentNode): Promise<void>
}

type RegisteredPlugin<TResult> = {
  readonly order: number
  readonly plugin: AnyNodeRendererPlugin<TResult>
}

type LoadState = {
  readonly status: 'pending' | 'ready' | 'failed'
  readonly promise?: Promise<void>
  readonly error?: unknown
}

const DEFAULT_EXECUTION_POLICY: Required<RuntimeExecutionPolicy> = {
  allowLazy: true,
  allowClientOnly: true,
  allowDom: true
}

const sortRegisteredPlugins = <TResult>(
  plugins: readonly RegisteredPlugin<TResult>[]
): readonly RegisteredPlugin<TResult>[] =>
  [...plugins].sort((left, right) => {
    const priorityDelta = (right.plugin.priority ?? 0) - (left.plugin.priority ?? 0)
    if (priorityDelta !== 0) {
      return priorityDelta
    }
    return left.order - right.order
  })

export const createContentRuntime = <TResult>(
  options: CreateContentRuntimeOptions<TResult>
): ContentRuntime<TResult> => {
  const policy = {
    ...DEFAULT_EXECUTION_POLICY,
    ...options.executionPolicy
  }
  const plugins = new Map<ContentNode['type'], RegisteredPlugin<TResult>[]>()
  const loadStates = new Map<string, LoadState>()
  let nextOrder = 0

  const getRegisteredPlugins = (
    nodeType: ContentNode['type']
  ): readonly RegisteredPlugin<TResult>[] => sortRegisteredPlugins(plugins.get(nodeType) ?? [])

  const getPluginsForNodeType = (
    nodeType: ContentNode['type']
  ): readonly AnyNodeRendererPlugin<TResult>[] => getRegisteredPlugins(nodeType).map((entry) => entry.plugin)

  const matchesNode = (
    plugin: AnyNodeRendererPlugin<TResult>,
    node: ContentNode
  ): boolean => {
    if (!plugin.matches) {
      return true
    }
    return (
      plugin.matches as (candidate: ContentNodeByType[typeof plugin.nodeType]) => boolean
    )(node)
  }

  const policyAllows = (plugin: AnyNodeRendererPlugin<TResult>): boolean => {
    const requirements = plugin.requirements
    if (!requirements) {
      return true
    }
    if (requirements.lazy && !policy.allowLazy) {
      return false
    }
    if (requirements.clientOnly && !policy.allowClientOnly) {
      return false
    }
    if (requirements.needsDom && !policy.allowDom) {
      return false
    }
    return true
  }

  const selectPlugin = (node: ContentNode): RuntimeResolution<TResult> => {
    const candidates = getPluginsForNodeType(node.type)
    if (candidates.length === 0) {
      return {
        ok: false,
        node,
        reason: 'noPlugin',
        candidates
      }
    }

    const matched = candidates.filter((plugin) => matchesNode(plugin, node))
    if (matched.length === 0) {
      return {
        ok: false,
        node,
        reason: 'noMatch',
        candidates
      }
    }

    const eligible = matched.filter((plugin) => policyAllows(plugin))
    if (eligible.length === 0) {
      const plugin = matched[0]
      if (!plugin) {
        return {
          ok: false,
          node,
          reason: 'policyBlocked',
          candidates
        }
      }
      return {
        ok: false,
        node,
        reason: 'policyBlocked',
        plugin,
        candidates
      }
    }

    const plugin = eligible[0]
    if (!plugin) {
      return {
        ok: false,
        node,
        reason: 'noMatch',
        candidates
      }
    }

    return {
      ok: true,
      plugin,
      candidates
    }
  }

  const resolve = (node: ContentNode): RuntimeResolution<TResult> => {
    const selected = selectPlugin(node)
    if (!selected.ok) {
      return selected
    }

    const loadState = loadStates.get(selected.plugin.id)
    if (loadState?.status === 'failed') {
      return {
        ok: false,
        node,
        reason: 'loadFailed',
        plugin: selected.plugin,
        candidates: selected.candidates,
        error: loadState.error
      }
    }

    return selected
  }

  const fallbackFor = (failure: RuntimeFailureContext<TResult>): TResult => {
    if (failure.plugin?.fallback) {
      try {
        return (
          failure.plugin.fallback as (
            node: ContentNode,
            ctx: RuntimeFailureContext<TResult>
          ) => TResult
        )(failure.node, failure)
      } catch {
        // Fall through to the host fallback below.
      }
    }
    return options.fallback(failure)
  }

  const renderNode = (node: ContentNode, renderOptions?: RenderNodeOptions): TResult => {
    const isStreaming = renderOptions?.isStreaming ?? false
    const resolution = resolve(node)
    if (!resolution.ok) {
      return fallbackFor(resolution)
    }

    const createFallback = (
      reason: RuntimeFailureReason = 'renderFailed',
      error?: unknown
    ): TResult =>
      fallbackFor({
        node,
        reason,
        error,
        plugin: resolution.plugin,
        candidates: resolution.candidates
      })

    let result: TResult
    try {
      result = (
        resolution.plugin.render as (candidate: ContentNode, ctx: RenderContext<TResult>) => TResult
      )(node, {
        renderBlock: (child) => renderNode(child, { isStreaming }),
        isStreaming
      })
    } catch (error) {
      return createFallback('renderFailed', error)
    }

    if (options.wrap) {
      return options.wrap(result, {
        node,
        plugin: resolution.plugin,
        fallback: createFallback
      })
    }
    return result
  }

  const preparePlugin = (plugin: AnyNodeRendererPlugin<TResult>): Promise<void> => {
    if (!plugin.load) {
      return Promise.resolve()
    }

    const cached = loadStates.get(plugin.id)
    if (cached?.status === 'pending' && cached.promise) {
      return cached.promise
    }
    if (cached?.status === 'ready') {
      return Promise.resolve()
    }

    const promise = Promise.resolve()
      .then(() => plugin.load?.())
      .then(() => {
        loadStates.set(plugin.id, { status: 'ready' })
      })
      .catch((error: unknown) => {
        loadStates.set(plugin.id, {
          status: 'failed',
          error
        })
        throw error
      })

    loadStates.set(plugin.id, {
      status: 'pending',
      promise
    })

    return promise
  }

  const prepareNode = (node: ContentNode): Promise<void> => {
    const selected = selectPlugin(node)
    if (!selected.ok) {
      return Promise.resolve()
    }
    return preparePlugin(selected.plugin)
  }

  return {
    register<TType extends ContentNode['type']>(plugin: NodeRendererPlugin<TType, TResult>) {
      const list = plugins.get(plugin.nodeType) ?? []
      list.push({
        order: nextOrder,
        plugin: plugin as AnyNodeRendererPlugin<TResult>
      })
      nextOrder += 1
      plugins.set(plugin.nodeType, list)
    },
    resolve,
    renderNode,
    prepareNode
  }
}
