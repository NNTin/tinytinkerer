import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
  isStreaming?: boolean
}

export const MarkdownContent = ({ content, isStreaming = false }: Props) => (
  <div className={`prose-assistant${isStreaming ? ' streaming-cursor' : ''}`}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
)
