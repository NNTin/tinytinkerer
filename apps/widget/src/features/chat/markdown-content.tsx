import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export const MarkdownContent = ({ content }: { content: string }) => (
  <div className="widget-prose text-sm">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </div>
)
