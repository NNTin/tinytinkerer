import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownContentProps = {
  content: string
  isStreaming?: boolean
  className?: string
}

export const MarkdownContent = ({
  content,
  isStreaming = false,
  className
}: MarkdownContentProps) => (
  <div className={[className, isStreaming ? 'streaming-cursor' : undefined].filter(Boolean).join(' ')}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
)
