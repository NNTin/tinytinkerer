import type { AssistantContentDocument } from '@tinytinkerer/contracts'
import { ContentDocumentContent } from '@tinytinkerer/content-react'
import { mermaidPlugin } from '@tinytinkerer/content-mermaid'
import { wireframePlugin } from '@tinytinkerer/content-wireframe'

export type AssistantContentProps = {
  content: AssistantContentDocument
  isStreaming?: boolean
  className?: string
}

const assistantPlugins = [mermaidPlugin, wireframePlugin]

export const AssistantContent = ({
  content,
  isStreaming = false,
  className
}: AssistantContentProps) => (
  <ContentDocumentContent
    document={content}
    isStreaming={isStreaming}
    plugins={assistantPlugins}
    {...(className ? { className } : {})}
  />
)
