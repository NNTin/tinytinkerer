import { MarkdownContent } from '@tinytinkerer/content-markdown'
import { mermaidPlugin } from '@tinytinkerer/content-mermaid'
import { createReactContentRuntime } from '@tinytinkerer/content-react'
import { wireframePlugin } from '@tinytinkerer/content-wireframe'

export type AssistantContentProps = {
  content: string
  isStreaming?: boolean
  className?: string
}

const assistantRuntime = createReactContentRuntime()
assistantRuntime.register(mermaidPlugin)
assistantRuntime.register(wireframePlugin)

export const AssistantContent = ({
  content,
  isStreaming = false,
  className
}: AssistantContentProps) => (
  <MarkdownContent
    content={content}
    isStreaming={isStreaming}
    runtime={assistantRuntime}
    {...(className ? { className } : {})}
  />
)
