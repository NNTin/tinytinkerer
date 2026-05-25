import { parseMarkdownContent } from '@tinytinkerer/content-markdown'
import {
  ContentDocumentRenderer,
  createContentRendererRegistry
} from '@tinytinkerer/content-react'
import { lazy, Suspense, useMemo } from 'react'

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
    <Suspense>
      <ContentDocumentRenderer
        document={document}
        isStreaming={isStreaming}
        renderers={assistantContentRenderers}
        {...(className ? { className } : {})}
      />
    </Suspense>
  )
}
