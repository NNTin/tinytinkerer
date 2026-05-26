import { MarkdownContent } from '@tinytinkerer/content-markdown'
import { lazy } from 'react'

const MermaidNodeRenderer = lazy(() =>
  import('@tinytinkerer/content-mermaid').then((m) => ({ default: m.MermaidNodeRenderer }))
)

const WireframeNodeRenderer = lazy(() =>
  import('@tinytinkerer/content-wireframe').then((m) => ({ default: m.WireframeNodeRenderer }))
)

export type AssistantContentProps = {
  content: string
  isStreaming?: boolean
  className?: string
}

const assistantContentRenderers = {
  mermaid: MermaidNodeRenderer,
  wireframe: WireframeNodeRenderer
}

export const AssistantContent = ({
  content,
  isStreaming = false,
  className
}: AssistantContentProps) => (
  <MarkdownContent
    content={content}
    isStreaming={isStreaming}
    renderers={assistantContentRenderers}
    {...(className ? { className } : {})}
  />
)
