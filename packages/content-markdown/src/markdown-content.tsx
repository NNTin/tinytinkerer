import { useMemo } from 'react'
import type { ReactContentPlugin, RuntimeExecutionPolicy } from '@tinytinkerer/content-react'
import { ContentDocumentContent } from './content-document-content'
import { parseMarkdownContent } from './parse-markdown-content'

export type MarkdownContentProps = {
  content: string
  className?: string
  isStreaming?: boolean
  plugins?: readonly ReactContentPlugin[]
  executionPolicy?: RuntimeExecutionPolicy
}

export const MarkdownContent = ({
  content,
  className,
  isStreaming = false,
  plugins,
  executionPolicy
}: MarkdownContentProps) => {
  const document = useMemo(() => parseMarkdownContent(content), [content])

  return (
    <ContentDocumentContent
      document={document}
      isStreaming={isStreaming}
      {...(className ? { className } : {})}
      {...(plugins ? { plugins } : {})}
      {...(executionPolicy ? { executionPolicy } : {})}
    />
  )
}
