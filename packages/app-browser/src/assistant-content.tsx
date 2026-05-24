import { parseMarkdownContent } from '@tinytinkerer/content-markdown'
import { MermaidNodeRenderer } from '@tinytinkerer/content-mermaid'
import {
  ContentDocumentRenderer,
  createContentRendererRegistry
} from '@tinytinkerer/content-react'
import { WireframeNodeRenderer } from '@tinytinkerer/content-wireframe'
import { useMemo } from 'react'

export type AssistantContentProps = {
  content: string
  isStreaming?: boolean
  className?: string
}

const assistantContentRenderers = createContentRendererRegistry({
  mermaid: MermaidNodeRenderer,
  wireframe: WireframeNodeRenderer
})

export const AssistantContent = ({
  content,
  isStreaming = false,
  className
}: AssistantContentProps) => {
  const document = useMemo(() => parseMarkdownContent(content), [content])

  return (
    <ContentDocumentRenderer
      document={document}
      isStreaming={isStreaming}
      renderers={assistantContentRenderers}
      {...(className ? { className } : {})}
    />
  )
}
