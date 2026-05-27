import type { AssistantContentDocument } from '@tinytinkerer/contracts'
import { ContentDocumentContent } from '@tinytinkerer/content-markdown'
import { mermaidPlugin } from '@tinytinkerer/content-mermaid'
import { wireframePlugin } from '@tinytinkerer/content-wireframe'
import { assistantContentDocumentToContentDocument } from './content-document'

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
    document={assistantContentDocumentToContentDocument(content)}
    isStreaming={isStreaming}
    plugins={assistantPlugins}
    {...(className ? { className } : {})}
  />
)
