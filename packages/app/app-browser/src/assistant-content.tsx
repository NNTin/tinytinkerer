import type { ContentDocument } from '@tinytinkerer/contracts'
import {
  CodeBlockFallback,
  ContentDocumentContent,
  reportContentRenderError,
  type CodeBlockNode,
  type ContentRenderOptions,
  type RenderContext,
  type ReactNodeRendererPlugin
} from '@tinytinkerer/content-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { calloutPlugin } from '@tinytinkerer/content-callout'
import { codePlugin as contentCodePlugin } from '@tinytinkerer/content-code'
import { imagePlugin } from '@tinytinkerer/content-image'
import { linkCardPlugin } from '@tinytinkerer/content-link-card'
import { tablePlugin } from '@tinytinkerer/content-table'
import { useOptionalBrowserApp } from './app'
import { useResolveMediaUrl } from './media-registry'
import { useRenderedContentSanitizer } from './assistant-content-policy'
import type { AppToolResultRecord } from './app-assistant-policy'

export type AssistantContentProps = {
  content: ContentDocument
  isStreaming?: boolean
  className?: string
  turnId?: string
  /**
   * This turn's successful tool results (issue #478). The app's render-time
   * content policy — the documentation assistant's link allowlist — is applied
   * against them, so an unauthorized link is never clickable, not even for the
   * seconds an answer is streaming. Omitted by hosts with no policy and by
   * surfaces with no turn (the content playground).
   */
  toolResults?: readonly AppToolResultRecord[]
}

const createLazyCodeBlockPlugin = (options: {
  id: string
  priority: number
  requirements: NonNullable<ReactNodeRendererPlugin<'codeBlock'>['requirements']>
  matches: (node: CodeBlockNode) => boolean
  loadPlugin: () => Promise<ReactNodeRendererPlugin<'codeBlock'>>
}): ReactNodeRendererPlugin<'codeBlock'> => {
  let plugin: ReactNodeRendererPlugin<'codeBlock'> | null = null
  let pluginPromise: Promise<ReactNodeRendererPlugin<'codeBlock'>> | null = null

  const renderFallback = (node: CodeBlockNode): ReactNode => (
    <CodeBlockFallback code={node.code} {...(node.language ? { language: node.language } : {})} />
  )

  const ensurePlugin = async (): Promise<ReactNodeRendererPlugin<'codeBlock'>> => {
    if (plugin) {
      return plugin
    }

    pluginPromise ??= options
      .loadPlugin()
      .then(async (loadedPlugin) => {
        await loadedPlugin.load?.()
        plugin = loadedPlugin
        return loadedPlugin
      })
      .catch((error: unknown) => {
        pluginPromise = null
        throw error
      })

    return pluginPromise
  }

  const LazyCodeBlockRenderer = ({
    node,
    ctx
  }: {
    node: CodeBlockNode
    ctx: RenderContext<ReactNode>
  }) => {
    const [failed, setFailed] = useState(false)
    const [, setRevision] = useState(0)

    useEffect(() => {
      if (plugin || failed) {
        return
      }

      let cancelled = false
      void ensurePlugin()
        .then(() => {
          if (!cancelled) {
            setRevision((value) => value + 1)
          }
        })
        .catch((error: unknown) => {
          // The lazy code-block plugin chunk failed to load. This path renders a
          // plain-code fallback; report it so the failure is not invisible.
          reportContentRenderError(error, {
            reason: 'loadFailed',
            nodeType: 'codeBlock',
            pluginId: options.id
          })
          if (!cancelled) {
            setFailed(true)
            setRevision((value) => value + 1)
          }
        })

      return () => {
        cancelled = true
      }
    }, [failed])

    if (!plugin) {
      return renderFallback(node)
    }

    return plugin.render(node, ctx)
  }

  return {
    id: options.id,
    nodeType: 'codeBlock',
    priority: options.priority,
    requirements: options.requirements,
    matches: options.matches,
    render: (node, ctx) => <LazyCodeBlockRenderer node={node} ctx={ctx} />,
    fallback: (node, failure) =>
      plugin?.fallback ? plugin.fallback(node, failure) : renderFallback(node)
  }
}

const codePlugin = createLazyCodeBlockPlugin({
  id: 'code',
  priority: 30,
  requirements: { clientOnly: true },
  matches: () => true,
  // content-code is imported statically: unlike the mermaid/wireframe renderers
  // below, its ReadOnlyCodeView is already pulled into the chat route chunk by
  // several eager panels (turn activity, context inspector, the permission modal),
  // so a dynamic import here bought no code-splitting — Rollup flagged it as
  // INEFFECTIVE_DYNAMIC_IMPORT. We keep the lazy wrapper only for its fallback /
  // load() lifecycle, resolving the already-bundled plugin synchronously.
  loadPlugin: () => Promise.resolve(contentCodePlugin)
})

const mermaidPlugin = createLazyCodeBlockPlugin({
  id: 'mermaid',
  priority: 50,
  requirements: { clientOnly: true, needsDom: true },
  matches: (node) => node.language === 'mermaid',
  loadPlugin: () => import('@tinytinkerer/content-mermaid').then((module) => module.mermaidPlugin)
})

const wireframePlugin = createLazyCodeBlockPlugin({
  id: 'wireframe',
  priority: 40,
  requirements: { clientOnly: true, needsDom: true },
  matches: (node) => node.language === 'wireframe',
  loadPlugin: () =>
    import('@tinytinkerer/content-wireframe').then((module) => module.wireframePlugin)
})

// Exported so hosts that need the exact same plugin set outside a live
// conversation (e.g. the docs rich-content playground, see
// content-playground.tsx) can register it on their own runtime without
// duplicating this composition.
export const assistantContentPlugins = [
  mermaidPlugin,
  wireframePlugin,
  codePlugin,
  calloutPlugin,
  linkCardPlugin,
  imagePlugin,
  tablePlugin
]

const useShowCodeBlockFullscreenButton = (): boolean => {
  const app = useOptionalBrowserApp()
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!app) return () => undefined
      return app.stores.settings.subscribe(() => {
        onStoreChange()
      })
    },
    [app]
  )
  const getSnapshot = useCallback(
    (): boolean => app?.stores.settings.getState().showCodeBlockFullscreenButton ?? true,
    [app]
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const NO_TOOL_RESULTS: readonly AppToolResultRecord[] = []

export const AssistantContent = ({
  content,
  isStreaming = false,
  className,
  turnId,
  toolResults = NO_TOOL_RESULTS
}: AssistantContentProps) => {
  const showCodeBlockFullscreenButton = useShowCodeBlockFullscreenButton()
  // Resolves the model's `media:<ref>` markdown image handles (see
  // content-image's ImageNodeRenderer) to their real data URLs, backed by the
  // conversation's persisted `agent.tool.completed` events.
  const resolveMediaUrl = useResolveMediaUrl()
  const renderOptions = useMemo<ContentRenderOptions>(
    () => ({
      ...(turnId ? { codeBlockPersistenceScopeId: turnId } : {}),
      showCodeBlockFullscreenButton,
      resolveMediaUrl
    }),
    [turnId, showCodeBlockFullscreenButton, resolveMediaUrl]
  )

  // Applied to every snapshot, not just the settled one. The sanitizer is
  // compiled once per results change (not per chunk) and returns the same
  // document by identity when it changes nothing, so a turn with nothing to
  // demote pays one walk and no extra render.
  const sanitizeRenderedContent = useRenderedContentSanitizer(toolResults)
  const document = useMemo(
    () => sanitizeRenderedContent(content),
    [sanitizeRenderedContent, content]
  )

  return (
    <ContentDocumentContent
      document={document}
      isStreaming={isStreaming}
      plugins={assistantContentPlugins}
      renderOptions={renderOptions}
      {...(className ? { className } : {})}
    />
  )
}
