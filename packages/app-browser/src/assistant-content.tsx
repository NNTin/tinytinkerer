import { MarkdownContent } from '@tinytinkerer/content-markdown'
import { mermaidPlugin } from '@tinytinkerer/content-mermaid'
import { wireframePlugin } from '@tinytinkerer/content-wireframe'

export type AssistantContentProps = {
  content: string
  isStreaming?: boolean
  className?: string
}

const assistantPlugins = [mermaidPlugin, wireframePlugin]

export const AssistantContent = ({
  content,
  isStreaming = false,
  className
}: AssistantContentProps) => (
  <MarkdownContent
    content={content}
    isStreaming={isStreaming}
    plugins={assistantPlugins}
    {...(className ? { className } : {})}
  />
)
