import type { ContentDocument } from '@tinytinkerer/contracts'
import { ContentDocumentContent } from '@tinytinkerer/content-react'
import { calloutPlugin } from '@tinytinkerer/content-callout'
import { codePlugin } from '@tinytinkerer/content-code'
import { imagePlugin } from '@tinytinkerer/content-image'
import { linkCardPlugin } from '@tinytinkerer/content-link-card'
import { mermaidPlugin } from '@tinytinkerer/content-mermaid'
import { tablePlugin } from '@tinytinkerer/content-table'
import { wireframePlugin } from '@tinytinkerer/content-wireframe'

export type AssistantContentProps = {
  content: ContentDocument
  isStreaming?: boolean
  className?: string
}

const assistantPlugins = [
  mermaidPlugin,
  wireframePlugin,
  codePlugin,
  calloutPlugin,
  linkCardPlugin,
  imagePlugin,
  tablePlugin
]

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
