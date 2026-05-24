import {
  Component,
  Fragment,
  type ComponentType,
  type ReactNode
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  type CodeBlockNode,
  type ChoicePromptNode,
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

const TableNodeView = ({ node }: ContentNodeRendererProps<TableNode>) => (
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
)

const ImageNodeView = ({ node }: ContentNodeRendererProps<ImageNode>) => (
  <img src={node.url} alt={node.alt} title={node.title} />
)

const ChoicePromptNodeView = ({ node }: ContentNodeRendererProps<ChoicePromptNode>) => (
  <div>
    <p>{node.prompt}</p>
    <ul>
      {node.choices.map((choice) => (
        <li key={choice}>{choice}</li>
      ))}
    </ul>
  </div>
)

export const defaultContentRenderers = {
  markdown: MarkdownNodeView,
  codeBlock: CodeBlockNodeView,
  table: TableNodeView,
  image: ImageNodeView,
  choicePrompt: ChoicePromptNodeView
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

  if (node.type === 'choicePrompt') {
    return <ChoicePromptNodeView node={node} />
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
      <Fragment key={`${node.type}-${index}`}>{renderNode(node, renderers)}</Fragment>
    ))}
  </div>
)
