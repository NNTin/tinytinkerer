import {
  Component,
  Fragment,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  hashContent,
  type BlockquoteNode,
  type CodeBlockNode,
  type ContentDocument,
  type ContentNode,
  type ContentNodeByType,
  type HeadingNode,
  type ImageNode,
  type InlineNode,
  type ListItemNode,
  type ListNode,
  type MarkdownNode,
  type ParagraphNode,
  type TableAlignment,
  type TableNode
} from '@tinytinkerer/content-core'
import {
  createContentRuntime,
  type AnyNodeRendererPlugin,
  type ContentRuntime,
  type NodeRendererPlugin,
  type RenderContext
} from '@tinytinkerer/content-runtime'
import { cn } from '@tinytinkerer/ui'

export const MARKDOWN_ROOT_CLASS = 'tt-markdown'
export const MARKDOWN_STREAMING_CLASS = 'tt-markdown--streaming'

export type ContentNodeRendererProps<TNode extends ContentNode> = {
  node: TNode
}

export type ContentNodeRenderer<TNode extends ContentNode> =
  | ComponentType<ContentNodeRendererProps<TNode>>
  | LazyExoticComponent<ComponentType<ContentNodeRendererProps<TNode>>>

export type ReactContentRendererRegistry = {
  [K in keyof ContentNodeByType]?: ContentNodeRenderer<ContentNodeByType[K]>
}

export type ReactContentRuntime = ContentRuntime<ReactNode>
export type ReactNodeRendererPlugin<TType extends ContentNode['type']> = NodeRendererPlugin<
  TType,
  ReactNode
>

type ContentDocumentRendererProps = {
  document: ContentDocument
  className?: string
  isStreaming?: boolean
  renderers?: ReactContentRendererRegistry
  runtime?: ReactContentRuntime
}

type RendererBoundaryProps = {
  fallback: ReactNode
  children: ReactNode
}

type RendererBoundaryState = {
  hasError: boolean
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

const renderInline = (nodes: InlineNode[]): ReactNode =>
  nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.value}</Fragment>
      case 'emphasis':
        return <em key={index}>{renderInline(node.children)}</em>
      case 'strong':
        return <strong key={index}>{renderInline(node.children)}</strong>
      case 'strikethrough':
        return <del key={index}>{renderInline(node.children)}</del>
      case 'codeInline':
        return <code key={index}>{node.value}</code>
      case 'link':
        return (
          <a key={index} href={node.url} title={node.title}>
            {renderInline(node.children)}
          </a>
        )
      case 'imageInline':
        return <img key={index} src={node.url} alt={node.alt} title={node.title} />
      case 'break':
        return <br key={index} />
    }
  })

const HeadingNodeView = ({ node }: ContentNodeRendererProps<HeadingNode>) => {
  const Tag = `h${node.level}` as 'h1'
  return <Tag>{renderInline(node.children)}</Tag>
}

const ParagraphNodeView = ({ node }: ContentNodeRendererProps<ParagraphNode>) => (
  <p>{renderInline(node.children)}</p>
)

const ListItemNodeView = ({
  node,
  ctx
}: {
  node: ListItemNode
  ctx: RenderContext<ReactNode>
}) => (
  <li>
    {typeof node.checked === 'boolean' ? (
      <input type="checkbox" defaultChecked={node.checked} disabled />
    ) : null}
    {node.children.map((child, index) => (
      <Fragment key={resolveNodeKey(child, index)}>{ctx.renderBlock(child)}</Fragment>
    ))}
  </li>
)

const ListNodeView = ({
  node,
  ctx
}: {
  node: ListNode
  ctx: RenderContext<ReactNode>
}) => {
  const items = node.children.map((item, index) => (
    <ListItemNodeView key={item.id ?? `${node.id ?? 'list'}-item-${index}`} node={item} ctx={ctx} />
  ))
  if (node.ordered) {
    return <ol start={node.start}>{items}</ol>
  }
  return <ul>{items}</ul>
}

const BlockquoteNodeView = ({
  node,
  ctx
}: {
  node: BlockquoteNode
  ctx: RenderContext<ReactNode>
}) => (
  <blockquote>
    {node.children.map((child, index) => (
      <Fragment key={resolveNodeKey(child, index)}>{ctx.renderBlock(child)}</Fragment>
    ))}
  </blockquote>
)

const ThematicBreakNodeView = () => <hr />

const CodeBlockNodeView = ({ node }: ContentNodeRendererProps<CodeBlockNode>) => (
  <pre>
    <code className={node.language ? `language-${node.language}` : undefined}>{node.code}</code>
  </pre>
)

const MarkdownNodeView = ({ node }: ContentNodeRendererProps<MarkdownNode>) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]}>{node.markdown}</ReactMarkdown>
)

const ImageNodeView = ({ node }: ContentNodeRendererProps<ImageNode>) => (
  <img src={node.url} alt={node.alt} title={node.title} />
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

    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true)
      })
      .catch(() => {
        setCopied(false)
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
              aria-pressed={activeView === 'preview'}
              className={`${BUTTON_BASE} ${activeView === 'preview' ? BUTTON_ACTIVE : BUTTON_IDLE}`}
            >
              Preview
            </button>
          )}
          <button
            type="button"
            onClick={() => setView('code')}
            aria-pressed={activeView === 'code'}
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

export const TableNodeView = ({ node }: { node: TableNode }) => {
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
      <TableMarkup node={node} />
    </div>
  )
}

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

const resolveNodeKey = (node: ContentNode, index: number): string => {
  if (node.id) {
    return node.id
  }
  const digest =
    'markdown' in node ? node.markdown
    : 'code' in node ? node.code
    : 'url' in node ? node.url
    : 'prompt' in node ? node.prompt
    : JSON.stringify(node)
  return `${node.type}-${hashContent(digest)}-${index}`
}

const defaultReactPlugins: AnyNodeRendererPlugin<ReactNode>[] = [
  {
    id: 'core:heading',
    nodeType: 'heading',
    render: (node) => <HeadingNodeView node={node} />
  },
  {
    id: 'core:paragraph',
    nodeType: 'paragraph',
    render: (node) => <ParagraphNodeView node={node} />
  },
  {
    id: 'core:list',
    nodeType: 'list',
    render: (node, ctx) => <ListNodeView node={node} ctx={ctx} />
  },
  {
    id: 'core:blockquote',
    nodeType: 'blockquote',
    render: (node, ctx) => <BlockquoteNodeView node={node} ctx={ctx} />
  },
  {
    id: 'core:thematicBreak',
    nodeType: 'thematicBreak',
    render: () => <ThematicBreakNodeView />
  },
  {
    id: 'core:markdown',
    nodeType: 'markdown',
    render: (node) => <MarkdownNodeView node={node} />
  },
  {
    id: 'core:codeBlock',
    nodeType: 'codeBlock',
    render: (node) => <CodeBlockNodeView node={node} />
  },
  {
    id: 'core:table',
    nodeType: 'table',
    render: (node) => <TableNodeView node={node} />
  },
  {
    id: 'core:image',
    nodeType: 'image',
    render: (node) => <ImageNodeView node={node} />
  }
]

const renderersToPlugins = (
  renderers: ReactContentRendererRegistry
): AnyNodeRendererPlugin<ReactNode>[] => {
  const plugins: AnyNodeRendererPlugin<ReactNode>[] = []
  for (const entry of Object.entries(renderers)) {
    const [nodeType, Renderer] = entry as [
      ContentNode['type'],
      ContentNodeRenderer<ContentNode> | undefined
    ]
    if (!Renderer) {
      continue
    }
    plugins.push({
      id: `override:${nodeType}`,
      nodeType,
      render: (node: ContentNode) => {
        const TypedRenderer = Renderer as ComponentType<ContentNodeRendererProps<ContentNode>>
        return <TypedRenderer node={node} />
      }
    } as AnyNodeRendererPlugin<ReactNode>)
  }
  return plugins
}

export const createReactContentRuntime = (): ReactContentRuntime => {
  const runtime = createContentRuntime<ReactNode>({
    fallback: (node) => genericNodeFallback(node),
    wrap: (children, ctx) => {
      const fallbackNode = ctx.fallback()
      return (
        <Suspense fallback={fallbackNode}>
          <RendererBoundary fallback={fallbackNode}>{children}</RendererBoundary>
        </Suspense>
      )
    }
  })
  for (const plugin of defaultReactPlugins) {
    runtime.register(plugin)
  }
  return runtime
}

let cachedDefaultRuntime: ReactContentRuntime | null = null

const getDefaultRuntime = (): ReactContentRuntime => {
  if (!cachedDefaultRuntime) {
    cachedDefaultRuntime = createReactContentRuntime()
  }
  return cachedDefaultRuntime
}

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

export const ContentDocumentRenderer = ({
  document,
  className,
  isStreaming = false,
  renderers,
  runtime
}: ContentDocumentRendererProps) => {
  const activeRuntime = useMemo(() => {
    if (runtime) {
      return runtime
    }
    if (renderers && Object.keys(renderers).length > 0) {
      const built = createReactContentRuntime()
      for (const plugin of renderersToPlugins(renderers)) {
        built.register(plugin)
      }
      return built
    }
    return getDefaultRuntime()
  }, [runtime, renderers])

  return (
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
        <Fragment key={resolveNodeKey(node, index)}>{activeRuntime.renderNode(node)}</Fragment>
      ))}
    </div>
  )
}

const alignToMarkdown = (align: TableAlignment): string => {
  if (align === 'left') return ':---'
  if (align === 'right') return '---:'
  if (align === 'center') return ':---:'
  return '---'
}

const formatTableCell = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br />')
    .replace(/\|/g, '\\|')
    .trim()

export const tableToMarkdown = (node: TableNode): string => {
  const width = node.header.length
  const header = `| ${node.header.map(formatTableCell).join(' | ')} |`
  const separator = `| ${Array.from({ length: width }, (_, index) => alignToMarkdown(node.align[index] ?? null)).join(' | ')} |`
  const rows = node.rows.map((row) =>
    `| ${Array.from({ length: width }, (_, index) => formatTableCell(row[index] ?? '')).join(' | ')} |`
  )
  return [header, separator, ...rows].join('\n')
}

const TableMarkup = ({ node }: { node: TableNode }) => (
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
