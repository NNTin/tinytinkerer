// Facade for docs/dev-tool surfaces that want to run the REAL content
// platform (parser + React runtime + specialized renderer plugins) against
// arbitrary, locally-typed markdown — without a live conversation, a model
// call, or a direct `content-*` import (browser apps may depend only on
// app-browser/ui, see scripts/check-boundaries.mjs). The docs rich-content
// playground (issue #455) is the first consumer.
import { parseMarkdownContent } from '@tinytinkerer/content-markdown'
import {
  ContentDocumentContent,
  createReactContentRuntime,
  useCopyButtonState,
  type CodeBlockNode,
  type ContentDocument,
  type ContentNode,
  type ReactContentPlugin,
  type ReactContentRuntime,
  type ReactNodeRendererPlugin,
  type RuntimeFailureReason
} from '@tinytinkerer/content-react'
import { assistantContentPlugins } from './assistant-content'

export type { ContentDocument, ContentNode } from '@tinytinkerer/content-react'
// Re-exported so hosts that build their own chrome around
// ContentPlaygroundPreview (e.g. a "copy source" button) reuse the exact copy/
// reset-after-2s behavior PreviewCodeFrame's own copy button uses, instead of
// forking it.
export { useCopyButtonState }

/**
 * Parses raw markdown into the same semantic `ContentDocument` the product's
 * chat surface renders — synchronous, in-memory, no network/model call.
 */
export const parsePlaygroundMarkdown = (markdown: string): ContentDocument =>
  parseMarkdownContent(markdown)

// A fenced code block with this language never ships to real conversations —
// it exists only so the playground can demonstrate that a genuine render-time
// throw from a plugin is contained by the real runtime's error boundary
// (RendererBoundary in @tinytinkerer/content-react) instead of taking down the
// page. Every other plugin registered alongside it is the exact production
// plugin used by AssistantContent.
export const PLAYGROUND_ERROR_DEMO_LANGUAGE = 'tt-playground-throw'

const playgroundErrorDemoPlugin: ReactNodeRendererPlugin<'codeBlock'> = {
  id: 'playground-error-demo',
  nodeType: 'codeBlock',
  priority: 60,
  matches: (node: CodeBlockNode) => node.language === PLAYGROUND_ERROR_DEMO_LANGUAGE,
  render: () => {
    throw new Error(
      'Playground demo: this renderer always throws to exercise fallback containment.'
    )
  }
}

export const playgroundContentPlugins: readonly ReactContentPlugin[] = [
  ...assistantContentPlugins,
  playgroundErrorDemoPlugin
]

let cachedPlaygroundRuntime: ReactContentRuntime | null = null

const getPlaygroundRuntime = (): ReactContentRuntime => {
  if (!cachedPlaygroundRuntime) {
    const runtime = createReactContentRuntime()
    for (const plugin of playgroundContentPlugins) {
      runtime.register(plugin)
    }
    cachedPlaygroundRuntime = runtime
  }
  return cachedPlaygroundRuntime
}

export type PlaygroundPluginResolution =
  | { readonly ok: true; readonly pluginId: string; readonly nodeType: ContentNode['type'] }
  | {
      readonly ok: false
      readonly reason: RuntimeFailureReason
      readonly nodeType: ContentNode['type']
    }

/**
 * Resolves which registered plugin would render a given AST node, using the
 * exact plugin set `AssistantContent` renders with (plus the harmless demo
 * plugin above). Lets the playground show "this syntax renders via the
 * `mermaid` plugin" without duplicating the runtime's own dispatch/priority
 * logic.
 */
export const resolvePlaygroundNodePlugin = (node: ContentNode): PlaygroundPluginResolution => {
  const resolution = getPlaygroundRuntime().resolve(node)
  if (resolution.ok) {
    return { ok: true, pluginId: resolution.plugin.id, nodeType: node.type }
  }
  return { ok: false, reason: resolution.reason, nodeType: node.type }
}

export type ContentPlaygroundPreviewProps = {
  document: ContentDocument
  className?: string
}

/**
 * Renders a `ContentDocument` through the real React content runtime and the
 * same specialized renderer plugins `AssistantContent` uses in production
 * chat, plus the playground-only error-containment demo plugin above.
 */
export const ContentPlaygroundPreview = ({
  document,
  className
}: ContentPlaygroundPreviewProps) => (
  <ContentDocumentContent
    document={document}
    plugins={playgroundContentPlugins}
    {...(className ? { className } : {})}
  />
)
