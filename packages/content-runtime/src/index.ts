import type {
  ContentDocument,
  ContentNode,
  ContentNodeByType
} from '@tinytinkerer/content-core'

export type NodeRendererPluginCapabilities = {
  readonly lazy?: boolean
  readonly preview?: boolean
}

export type RenderContext<TResult> = {
  readonly renderBlock: (node: ContentNode) => TResult
}

export interface NodeRendererPlugin<TType extends ContentNode['type'], TResult> {
  readonly id: string
  readonly nodeType: TType
  readonly capabilities?: NodeRendererPluginCapabilities
  load?(): Promise<void>
  render(node: ContentNodeByType[TType], ctx: RenderContext<TResult>): TResult
  fallback?(node: ContentNodeByType[TType], error?: unknown): TResult
}

export type AnyNodeRendererPlugin<TResult> = {
  [K in ContentNode['type']]: NodeRendererPlugin<K, TResult>
}[ContentNode['type']]

export type RuntimeFallback<TResult> = (node: ContentNode, error?: unknown) => TResult

export type RuntimeWrapContext<TResult> = {
  readonly node: ContentNode
  readonly plugin: AnyNodeRendererPlugin<TResult>
  readonly fallback: (error?: unknown) => TResult
}

export type RuntimeWrap<TResult> = (
  result: TResult,
  ctx: RuntimeWrapContext<TResult>
) => TResult

export type CreateContentRuntimeOptions<TResult> = {
  readonly fallback: RuntimeFallback<TResult>
  readonly wrap?: RuntimeWrap<TResult>
}

export interface ContentRuntime<TResult> {
  register<TType extends ContentNode['type']>(plugin: NodeRendererPlugin<TType, TResult>): void
  has(nodeType: ContentNode['type']): boolean
  getPlugin<TType extends ContentNode['type']>(
    nodeType: TType
  ): NodeRendererPlugin<TType, TResult> | undefined
  renderNode(node: ContentNode): TResult
  renderDocument(doc: ContentDocument): TResult[]
  ensureLoaded(node: ContentNode): Promise<void>
}

export const createContentRuntime = <TResult>(
  options: CreateContentRuntimeOptions<TResult>
): ContentRuntime<TResult> => {
  const plugins = new Map<ContentNode['type'], AnyNodeRendererPlugin<TResult>>()
  const loadPromises = new Map<ContentNode['type'], Promise<void>>()

  const fallbackFor = (
    node: ContentNode,
    plugin: AnyNodeRendererPlugin<TResult> | undefined,
    error?: unknown
  ): TResult => {
    if (plugin?.fallback) {
      try {
        return (plugin.fallback as (n: ContentNode, e?: unknown) => TResult)(node, error)
      } catch {
        // fall through to the host fallback below
      }
    }
    return options.fallback(node, error)
  }

  const renderNode = (node: ContentNode): TResult => {
    const plugin = plugins.get(node.type)
    if (!plugin) {
      return options.fallback(node)
    }

    const callFallback = (error?: unknown): TResult => fallbackFor(node, plugin, error)

    let result: TResult
    try {
      result = (plugin.render as (n: ContentNode, ctx: RenderContext<TResult>) => TResult)(node, {
        renderBlock: renderNode
      })
    } catch (error) {
      return callFallback(error)
    }

    if (options.wrap) {
      return options.wrap(result, {
        node,
        plugin,
        fallback: callFallback
      })
    }
    return result
  }

  const ensureLoaded = (node: ContentNode): Promise<void> => {
    const plugin = plugins.get(node.type)
    if (!plugin?.load) {
      return Promise.resolve()
    }
    const cached = loadPromises.get(node.type)
    if (cached) {
      return cached
    }
    const promise = Promise.resolve()
      .then(() => plugin.load?.())
      .then(() => undefined)
      .catch((error: unknown) => {
        loadPromises.delete(node.type)
        throw error
      })
    loadPromises.set(node.type, promise)
    return promise
  }

  return {
    register<TType extends ContentNode['type']>(plugin: NodeRendererPlugin<TType, TResult>) {
      plugins.set(plugin.nodeType, plugin as AnyNodeRendererPlugin<TResult>)
    },
    has(nodeType) {
      return plugins.has(nodeType)
    },
    getPlugin<TType extends ContentNode['type']>(nodeType: TType) {
      return plugins.get(nodeType) as NodeRendererPlugin<TType, TResult> | undefined
    },
    renderNode,
    renderDocument(doc) {
      return doc.nodes.map((node) => renderNode(node))
    },
    ensureLoaded
  }
}
