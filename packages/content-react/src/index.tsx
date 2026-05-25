import {
  Component,
  Fragment,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
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
  type MarkdownNode
} from '@tinytinkerer/content-core'
import { TableNodeView as MarkdownTableNodeView, tableToMarkdown } from '@tinytinkerer/content-markdown'
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

const COPY_RESET_DELAY_MS = 2000

const BUTTON_BASE = 'text-[11px] font-medium transition-colors px-1.5 py-0.5 rounded'
const BUTTON_IDLE = 'text-stone-500 hover:text-stone-700'
const BUTTON_ACTIVE = 'bg-stone-100 text-stone-700'

const useCopyButtonState = (value: string) => {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setCopied(false)
    }, COPY_RESET_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [copied])

  const copy = () => {
    if (!navigator.clipboard?.writeText) {
      return
    }

    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
    })
  }

  return { copied, copy }
}

type PreviewCodeFrameProps = {
  headerStart: ReactNode
  code: string
  codeLanguage?: string
  preview: ReactNode
  showPreview?: boolean
  codeView?: ReactNode
  className?: string
  containerProps?: Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'className'> &
    Partial<Record<`data-${string}`, string>>
}

export const PreviewCodeFrame = ({
  headerStart,
  code,
  codeLanguage,
  preview,
  showPreview = true,
  codeView,
  className,
  containerProps
}: PreviewCodeFrameProps) => {
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const { copied, copy } = useCopyButtonState(code)
  const activeView = showPreview && view === 'preview' ? 'preview' : 'code'

  return (
    <div
      {...containerProps}
      className={cn('overflow-hidden rounded-lg border border-stone-200 bg-stone-50', className)}
    >
      <div className="flex items-center justify-between border-b border-stone-200 bg-white px-3 py-2">
        {headerStart}
        <div className="flex items-center gap-1">
          {showPreview && (
            <button
              type="button"
              onClick={() => setView('preview')}
              className={`${BUTTON_BASE} ${activeView === 'preview' ? BUTTON_ACTIVE : BUTTON_IDLE}`}
            >
              Preview
            </button>
          )}
          <button
            type="button"
            onClick={() => setView('code')}
            className={`${BUTTON_BASE} ${activeView === 'code' ? BUTTON_ACTIVE : BUTTON_IDLE}`}
          >
            Code
          </button>
          <span className="mx-1 h-3 w-px bg-stone-200" />
          <button type="button" onClick={copy} className={`${BUTTON_BASE} ${BUTTON_IDLE}`}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      {activeView === 'preview'
        ? preview
        : (codeView ?? (
            <CodeBlockFallback
              code={code}
              {...(codeLanguage ? { language: codeLanguage } : {})}
            />
          ))}
    </div>
  )
}

const TableNodeView = ({ node }: ContentNodeRendererProps<ContentNodeByType['table']>) => {
  const { copied, copy } = useCopyButtonState(tableToMarkdown(node))

  return (
    <div className="relative overflow-x-auto">
      <button
        type="button"
        onClick={copy}
        className="absolute top-1 right-1 text-[11px] font-medium text-stone-400 hover:text-stone-600 transition-colors px-1.5 py-0.5 rounded hover:bg-stone-100"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <MarkdownTableNodeView node={node} />
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
