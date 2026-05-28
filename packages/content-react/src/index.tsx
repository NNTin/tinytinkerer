import {
  Component,
  Fragment,
  Suspense,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode
} from 'react'
import {
  assignNodeIds,
  type BlockquoteNode,
  type CodeBlockNode,
  type ContentDocument,
  type ContentNode,
  type HeadingNode,
  type InlineNode,
  type ListItemNode,
  type ListNode,
  type ParagraphNode,
  type TableCell,
  type TableAlignment,
  type TableNode
} from '@tinytinkerer/content-core'
import {
  createContentRuntime,
  type AnyNodeRendererPlugin,
  type ContentRuntime,
  type NodeRendererPlugin,
  type RenderContext,
  type RuntimeExecutionPolicy
} from './runtime'
import { cn } from '@tinytinkerer/ui'

export { assignNodeIds, computeNodeId, hashContent } from '@tinytinkerer/content-core'
export type {
  BlockNode,
  BlockquoteNode,
  BreakNode,
  ChoicePromptNode,
  CodeBlockNode,
  CodeInlineNode,
  ContentDocument,
  ContentNode,
  ContentNodeByType,
  EmphasisNode,
  HeadingNode,
  ImageInlineNode,
  ImageNode,
  InlineNode,
  LinkNode,
  ListItemNode,
  ListNode,
  NodeId,
  ParagraphNode,
  StrikethroughNode,
  StrongNode,
  TableAlignment,
  TableCell,
  TableNode,
  TextNode,
  ThematicBreakNode
} from '@tinytinkerer/content-core'

export const MARKDOWN_ROOT_CLASS = 'tt-markdown'
export const MARKDOWN_STREAMING_CLASS = 'tt-markdown--streaming'

export type ContentNodeRendererProps<TNode extends ContentNode> = {
  node: TNode
}

export type ReactContentRuntime = ContentRuntime<ReactNode>
export type ReactNodeRendererPlugin<TType extends ContentNode['type']> = NodeRendererPlugin<
  TType,
  ReactNode
>
export type ReactContentPlugin = AnyNodeRendererPlugin<ReactNode>
export type CreateReactContentRuntimeOptions = {
  executionPolicy?: RuntimeExecutionPolicy
}

export const REACT_SSR_EXECUTION_POLICY: RuntimeExecutionPolicy = {
  allowLazy: false,
  allowClientOnly: false,
  allowDom: false
}

export type {
  RenderContext,
  RuntimeExecutionPolicy,
  RuntimeFailureContext,
  RuntimeFailureReason,
  RuntimeResolution
} from './runtime'

type ContentDocumentRendererProps = {
  document: ContentDocument
  className?: string
  isStreaming?: boolean
  runtime?: ReactContentRuntime
}

type RendererBoundaryProps = {
  fallback: ReactNode
  children: ReactNode
}

type RendererBoundaryState = {
  hasError: boolean
}

export type ContentRenderOptions = {
  codeBlockPersistenceScopeId?: string
  showCodeBlockFullscreenButton?: boolean
}

const ContentRenderOptionsContext = createContext<ContentRenderOptions>({})

export type ResolvedContentRenderOptions = {
  codeBlockPersistenceScopeId?: string
  showCodeBlockFullscreenButton: boolean
}

export const useContentRenderOptions = (): ResolvedContentRenderOptions => {
  const raw = useContext(ContentRenderOptionsContext)
  return {
    ...(raw.codeBlockPersistenceScopeId
      ? { codeBlockPersistenceScopeId: raw.codeBlockPersistenceScopeId }
      : {}),
    showCodeBlockFullscreenButton: raw.showCodeBlockFullscreenButton ?? true
  }
}

export type ContentDocumentContentProps = {
  document: ContentDocument
  className?: string
  isStreaming?: boolean
  plugins?: readonly ReactContentPlugin[]
  executionPolicy?: RuntimeExecutionPolicy
  renderOptions?: ContentRenderOptions
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

type PrepareRecord = {
  status: 'pending' | 'ready' | 'failed'
  promise?: Promise<void>
}

const preparedNodes = new WeakMap<ReactContentRuntime, Map<string, PrepareRecord>>()

const getPreparedNodes = (runtime: ReactContentRuntime): Map<string, PrepareRecord> => {
  let cache = preparedNodes.get(runtime)
  if (!cache) {
    cache = new Map<string, PrepareRecord>()
    preparedNodes.set(runtime, cache)
  }
  return cache
}

const readPreparedNode = (runtime: ReactContentRuntime, node: ContentNode): void => {
  if (!node.id) {
    return
  }

  const cache = getPreparedNodes(runtime)
  const resolution = runtime.resolve(node)
  if (!resolution.ok || !resolution.plugin.load) {
    cache.set(node.id, { status: 'ready' })
    return
  }

  const existing = cache.get(node.id)
  if (existing?.status === 'pending' && existing.promise) {
    // Suspense expects the in-flight preparation promise to be thrown here.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw existing.promise
  }
  if (existing) {
    return
  }

  const record: PrepareRecord = { status: 'pending' }
  record.promise = runtime.prepareNode(node).then(
    () => {
      record.status = 'ready'
    },
    () => {
      record.status = 'failed'
    }
  )
  cache.set(node.id, record)
  // Suspense expects the in-flight preparation promise to be thrown here.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw record.promise
}

const PreparedNodeBoundary = ({
  runtime,
  node,
  children
}: {
  runtime: ReactContentRuntime
  node: ContentNode
  children: ReactNode
}) => {
  readPreparedNode(runtime, node)
  return children
}

export const renderInline = (nodes: readonly InlineNode[]): ReactNode =>
  nodes.map((node, index) => {
    const key = node.id ?? `${node.type}-${index}`
    switch (node.type) {
      case 'text':
        return <Fragment key={key}>{node.value}</Fragment>
      case 'emphasis':
        return <em key={key}>{renderInline(node.children)}</em>
      case 'strong':
        return <strong key={key}>{renderInline(node.children)}</strong>
      case 'strikethrough':
        return <del key={key}>{renderInline(node.children)}</del>
      case 'codeInline':
        return <code key={key}>{node.value}</code>
      case 'link':
        return (
          <a key={key} href={node.url} title={node.title}>
            {renderInline(node.children)}
          </a>
        )
      case 'imageInline':
        return <img key={key} src={node.url} alt={node.alt} title={node.title} />
      case 'break':
        return <br key={key} />
    }
  })

const inlineNodesToText = (nodes: readonly InlineNode[]): string =>
  nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value
        case 'emphasis':
        case 'strong':
        case 'strikethrough':
        case 'link':
          return inlineNodesToText(node.children)
        case 'codeInline':
          return node.value
        case 'imageInline':
          return node.alt
        case 'break':
          return '\n'
      }
    })
    .join('')

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

const HeadingNodeView = ({ node }: ContentNodeRendererProps<HeadingNode>) => {
  const Tag = `h${node.level}` as HeadingTag
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
    {node.children.map((child) => (
      <Fragment key={child.id}>{ctx.renderBlock(child)}</Fragment>
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
  const items = node.children.map((item) => (
    <ListItemNodeView key={item.id} node={item} ctx={ctx} />
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
    {node.children.map((child) => (
      <Fragment key={child.id}>{ctx.renderBlock(child)}</Fragment>
    ))}
  </blockquote>
)

const ThematicBreakNodeView = () => <hr />

const CodeBlockNodeView = ({ node }: ContentNodeRendererProps<CodeBlockNode>) => (
  <pre>
    <code className={node.language ? `language-${node.language}` : undefined}>{node.code}</code>
  </pre>
)

const COPY_RESET_DELAY_MS = 2000

const BUTTON_BASE = 'text-[11px] font-medium transition-colors px-1.5 py-0.5 rounded'
const BUTTON_IDLE = 'text-stone-500 hover:text-stone-700'
const BUTTON_ACTIVE = 'bg-stone-100 text-stone-700'

export const useCopyButtonState = (value: string) => {
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
  if (node.type === 'codeBlock') {
    return (
      <CodeBlockFallback
        code={node.code}
        {...(node.language ? { language: node.language } : {})}
      />
    )
  }
  return <CodeBlockFallback code={JSON.stringify(node, null, 2)} language="json" />
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
    id: 'core:codeBlock',
    nodeType: 'codeBlock',
    priority: -100,
    render: (node) => <CodeBlockNodeView node={node} />
  }
]

export const createReactContentRuntime = (
  options: CreateReactContentRuntimeOptions = {}
): ReactContentRuntime => {
  const runtime = createContentRuntime<ReactNode>({
    fallback: (failure) => genericNodeFallback(failure.node),
    ...(options.executionPolicy ? { executionPolicy: options.executionPolicy } : {}),
    wrap: (children, ctx) => {
      const lazyFallback = <>{ctx.fallback()}</>
      return (
        <Suspense fallback={lazyFallback}>
          <RendererBoundary fallback={lazyFallback}>
            <PreparedNodeBoundary runtime={runtime} node={ctx.node}>
              {children}
            </PreparedNodeBoundary>
          </RendererBoundary>
        </Suspense>
      )
    }
  })
  for (const plugin of defaultReactPlugins) {
    runtime.register(plugin)
  }
  return runtime
}

export const ContentDocumentContent = ({
  document,
  className,
  isStreaming = false,
  plugins,
  executionPolicy,
  renderOptions
}: ContentDocumentContentProps) => {
  const normalizedDocument = useMemo(() => assignNodeIds(document), [document])
  const runtime = useMemo(() => {
    const built = createReactContentRuntime(
      executionPolicy ? { executionPolicy } : undefined
    )
    if (plugins) {
      for (const plugin of plugins) {
        built.register(plugin)
      }
    }
    return built
  }, [executionPolicy, plugins])

  const contextValue = useMemo<ContentRenderOptions>(
    () => renderOptions ?? {},
    [renderOptions]
  )

  return (
    <ContentRenderOptionsContext.Provider value={contextValue}>
      <ContentDocumentRenderer
        document={normalizedDocument}
        isStreaming={isStreaming}
        runtime={runtime}
        {...(className ? { className } : {})}
      />
    </ContentRenderOptionsContext.Provider>
  )
}

let cachedDefaultRuntime: ReactContentRuntime | null = null

const getDefaultRuntime = (): ReactContentRuntime => {
  if (!cachedDefaultRuntime) {
    cachedDefaultRuntime = createReactContentRuntime()
  }
  return cachedDefaultRuntime
}

export const ContentDocumentRenderer = ({
  document,
  className,
  isStreaming = false,
  runtime
}: ContentDocumentRendererProps) => {
  const activeRuntime = useMemo(() => runtime ?? getDefaultRuntime(), [runtime])

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
      {document.nodes.map((node) => (
        <Fragment key={node.id}>{activeRuntime.renderNode(node, { isStreaming })}</Fragment>
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

const tableCellToMarkdown = (cell: TableCell): string => formatTableCell(inlineNodesToText(cell))

export const tableToMarkdown = (node: TableNode): string => {
  const width = node.header.length
  const header = `| ${node.header.map(tableCellToMarkdown).join(' | ')} |`
  const separator = `| ${Array.from({ length: width }, (_, index) => alignToMarkdown(node.align[index] ?? null)).join(' | ')} |`
  const rows = node.rows.map((row) =>
    `| ${Array.from({ length: width }, (_, index) => tableCellToMarkdown(row[index] ?? [])).join(' | ')} |`
  )
  return [header, separator, ...rows].join('\n')
}

const TableMarkup = ({ node }: { node: TableNode }) => (
  <table>
    <thead>
      <tr>
        {node.header.map((cell, index) => (
          <th key={`header-${index}-${cell.map((item) => item.id ?? item.type).join('-')}`} align={node.align[index] ?? undefined}>
            {renderInline(cell)}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {node.rows.map((row, rowIndex) => (
        <tr key={`row-${rowIndex}-${row.map((cell) => cell.map((item) => item.id ?? item.type).join('-')).join('|')}`}>
          {row.map((cell, cellIndex) => (
            <td
              key={`cell-${rowIndex}-${cellIndex}-${cell.map((item) => item.id ?? item.type).join('-')}`}
              align={node.align[cellIndex] ?? undefined}
            >
              {renderInline(cell)}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
)
