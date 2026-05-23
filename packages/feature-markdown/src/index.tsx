import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

export const MARKDOWN_ROOT_CLASS = 'tt-markdown'
export const MARKDOWN_STREAMING_CLASS = 'tt-markdown--streaming'

type MarkdownContentProps = {
  content: string
  isStreaming?: boolean
  className?: string
  components?: Components
}

export const MarkdownContent = ({
  content,
  isStreaming = false,
  className,
  components
}: MarkdownContentProps) => (
  <div
    data-tt-markdown=""
    data-streaming={isStreaming ? 'true' : undefined}
    className={[
      MARKDOWN_ROOT_CLASS,
      className,
      isStreaming ? MARKDOWN_STREAMING_CLASS : undefined
    ]
      .filter(Boolean)
      .join(' ')}
  >
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  </div>
)
