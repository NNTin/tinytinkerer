import { MarkdownContent } from '@tinytinkerer/content-markdown'
import { mermaidRenderers } from '@tinytinkerer/content-mermaid'
import { wireframeRenderers } from '@tinytinkerer/content-wireframe'

export type AssistantContentProps = {
  content: string
  isStreaming?: boolean
  className?: string
}

const assistantContentRenderers = {
  ...mermaidRenderers,
  ...wireframeRenderers
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
