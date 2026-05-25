import {
  Component,
  Fragment,
  useState,
  type ComponentType,
  type ReactNode
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  type CodeBlockNode,
  type ContentDocument,
  type ContentNode,
  type ContentNodeByType,
  type ImageNode,
  type MarkdownNode,
  type TableNode
} from '@tinytinkerer/content-core'
import { cn } from '@tinytinkerer/ui'

export const MARKDOWN_ROOT_CLASS = 'tt-markdown'
export const MARKDOWN_STREAMING_CLASS = 'tt-markdown--streaming'

export type ContentNodeRendererProps<TNode extends ContentNode> = {
  node: TNode
}

export type ContentNodeRenderer<TNode extends ContentNode> = ComponentType<ContentNodeRendererProps<TNode>>

export type ReactContentRendererRegistry = {
  [K in keyof ContentNodeByType]?: ContentNodeRenderer<ContentNodeByType[K]>
}

type ContentDocumentRendererProps = {
  document: ContentDocument
  className?: string
  isStreaming?: boolean
  renderers?: ReactContentRendererRegistry
}

type RendererBoundaryProps = {
  fallback: ReactNode
  children: ReactNode
}

type RendererBoundaryState = {
  hasError: boolean
}

const CodeBlockNodeView = ({ node }: ContentNodeRendererProps<CodeBlockNode>) => (
  <pre>
    <code className={node.language ? `language-${node.language}` : undefined}>{node.code}</code>
  </pre>
)

const MarkdownNodeView = ({ node }: ContentNodeRendererProps<MarkdownNode>) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{node.markdown}</ReactMarkdown>
)

const alignToMarkdown = (align: 'left' | 'right' | 'center' | null): string => {
  if (align === 'left') return ':---'
  if (align === 'right') return '---:'
  if (align === 'center') return ':---:'
  return '---'
}

const tableToMarkdown = (node: TableNode): string => {
  const header = `| ${node.header.join(' | ')} |`
  const separator = `| ${node.align.map(alignToMarkdown).join(' | ')} |`
  const rows = node.rows.map((row) => `| ${row.join(' | ')} |`)
  return [header, separator, ...rows].join('\n')
}

const TableNodeView = ({ node }: ContentNodeRendererProps<TableNode>) => {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(tableToMarkdown(node)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="relative overflow-x-auto">
      <button
        type="button"
        onClick={copy}
        className="absolute top-1 right-1 text-[11px] font-medium text-stone-400 hover:text-stone-600 transition-colors px-1.5 py-0.5 rounded hover:bg-stone-100"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <table>
        <thead>
          <tr>
            {node.header.map((cell, index) => (
              <th key={`${index}-${cell}`} align={node.align[index] ?? undefined}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join('|')}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}-${cell}`} align={node.align[cellIndex] ?? undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ImageNodeView = ({ node }: ContentNodeRendererProps<ImageNode>) => (
  <img src={node.url} alt={node.alt} title={node.title} />
)

export const defaultContentRenderers = {
  markdown: MarkdownNodeView,
  codeBlock: CodeBlockNodeView,
  table: TableNodeView,
  image: ImageNodeView
} satisfies ReactContentRendererRegistry

export const createContentRendererRegistry = (
  overrides: ReactContentRendererRegistry = {}
): ReactContentRendererRegistry => ({
  ...defaultContentRenderers,
  ...overrides
})

export const CodeBlockFallback = ({
  code,
  language
}: {
  code: string
  language?: string
}) => <CodeBlockNodeView node={{ type: 'codeBlock', code, ...(language ? { language } : {}) }} />

const genericNodeFallback = (node: ContentNode): ReactNode => {
  if (node.type === 'mermaid' || node.type === 'wireframe') {
    return <CodeBlockFallback code={node.code} language={node.type} />
  }

  return <CodeBlockFallback code={JSON.stringify(node, null, 2)} language="json" />
}

class RendererBoundary extends Component<RendererBoundaryProps, RendererBoundaryState> {
  override state: RendererBoundaryState = { hasError: false }

  static getDerivedStateFromError(): RendererBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch() {}

  override render() {
    if (this.state.hasError) {
      return this.props.fallback
    }

    return this.props.children
  }
}

const renderNode = (node: ContentNode, renderers: ReactContentRendererRegistry): ReactNode => {
  const Renderer = renderers[node.type] as ContentNodeRenderer<typeof node> | undefined
  const fallback = genericNodeFallback(node)

  if (!Renderer) {
    return fallback
  }

  return (
    <RendererBoundary fallback={fallback}>
      <Renderer node={node} />
    </RendererBoundary>
  )
}

// djb2 hash for stable node keys — avoids type+index churn during streaming updates
const djb2 = (str: string): number => {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (((hash << 5) + hash) ^ str.charCodeAt(i)) >>> 0
  }
  return hash
}

const nodeKey = (node: ContentNode, index: number): string => {
  const primary =
    'markdown' in node ? node.markdown
    : 'code' in node ? node.code
    : 'url' in node ? node.url
    : 'prompt' in node ? node.prompt
    : JSON.stringify(node)
  return `${node.type}-${djb2(primary)}-${index}`
}

export const ContentDocumentRenderer = ({
  document,
  className,
  isStreaming = false,
  renderers = defaultContentRenderers
}: ContentDocumentRendererProps) => (
  <div
    data-tt-markdown=""
    data-streaming={isStreaming ? 'true' : undefined}
    className={cn(
      MARKDOWN_ROOT_CLASS,
      className,
      isStreaming && MARKDOWN_STREAMING_CLASS
    )}
  >
    {document.nodes.map((node, index) => (
      <Fragment key={nodeKey(node, index)}>{renderNode(node, renderers)}</Fragment>
    ))}
  </div>
)
