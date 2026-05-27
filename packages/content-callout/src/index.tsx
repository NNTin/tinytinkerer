import { Fragment } from 'react'
import type {
  BlockNode,
  BlockquoteNode,
  ContentNodeRendererProps,
  InlineNode,
  ParagraphNode,
  ReactNodeRendererPlugin,
  RenderContext,
  TextNode
} from '@tinytinkerer/content-react'
import type { ReactNode } from 'react'

const CALLOUT_PATTERN = /^\s*\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*\n?/i

type CalloutKind = 'note' | 'tip' | 'warning' | 'important' | 'caution'

type CalloutMatch = {
  readonly kind: CalloutKind
  readonly leadingTextRemainder: string
  readonly firstParagraph: ParagraphNode
}

const detectCallout = (node: BlockquoteNode): CalloutMatch | null => {
  const firstChild = node.children[0]
  if (!firstChild || firstChild.type !== 'paragraph') {
    return null
  }
  const firstInline = firstChild.children[0]
  if (!firstInline || firstInline.type !== 'text') {
    return null
  }
  const match = CALLOUT_PATTERN.exec(firstInline.value)
  if (!match || !match[1]) {
    return null
  }
  const kind = match[1].toLowerCase() as CalloutKind
  return {
    kind,
    leadingTextRemainder: firstInline.value.slice(match[0].length),
    firstParagraph: firstChild
  }
}

type CalloutStyle = {
  readonly label: string
  readonly icon: ReactNode
  readonly containerClass: string
  readonly iconClass: string
  readonly labelClass: string
}

const CALLOUT_STYLES: Record<CalloutKind, CalloutStyle> = {
  note: {
    label: 'Note',
    icon: <CalloutIcon path="M12 16v-4m0-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    containerClass: 'border-blue-200 bg-blue-50',
    iconClass: 'text-blue-600',
    labelClass: 'text-blue-700'
  },
  tip: {
    label: 'Tip',
    icon: <CalloutIcon path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
    containerClass: 'border-green-200 bg-green-50',
    iconClass: 'text-green-600',
    labelClass: 'text-green-700'
  },
  warning: {
    label: 'Warning',
    icon: (
      <CalloutIcon path="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3l-6.93-12a2 2 0 00-3.48 0L3.33 16a2 2 0 001.74 3z" />
    ),
    containerClass: 'border-amber-200 bg-amber-50',
    iconClass: 'text-amber-600',
    labelClass: 'text-amber-700'
  },
  important: {
    label: 'Important',
    icon: <CalloutIcon path="M12 8v4m0 4h.01M3 12a9 9 0 1018 0 9 9 0 00-18 0z" />,
    containerClass: 'border-purple-200 bg-purple-50',
    iconClass: 'text-purple-600',
    labelClass: 'text-purple-700'
  },
  caution: {
    label: 'Caution',
    icon: <CalloutIcon path="M18.36 18.36L5.64 5.64M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    containerClass: 'border-red-200 bg-red-50',
    iconClass: 'text-red-600',
    labelClass: 'text-red-700'
  }
}

function CalloutIcon({ path }: { path: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="2"
      stroke="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  )
}

const stripFirstTextNode = (
  paragraph: ParagraphNode,
  replacement: string
): ParagraphNode => {
  const [first, ...rest] = paragraph.children
  if (!first) {
    return paragraph
  }
  const next: InlineNode[] = []
  if (first.type === 'text') {
    const trimmedReplacement = replacement.replace(/^\s+/, '')
    if (trimmedReplacement.length > 0) {
      const replacedText: TextNode = { ...first, value: trimmedReplacement }
      next.push(replacedText)
    }
  } else {
    next.push(first)
  }
  next.push(...rest)
  return { ...paragraph, children: next }
}

export const CalloutNodeRenderer = ({
  node,
  ctx,
  match
}: ContentNodeRendererProps<BlockquoteNode> & {
  ctx: RenderContext<ReactNode>
  match: CalloutMatch
}) => {
  const style = CALLOUT_STYLES[match.kind]
  const strippedFirst = stripFirstTextNode(match.firstParagraph, match.leadingTextRemainder)
  const remainingFirstHasContent = strippedFirst.children.length > 0
  const restOfBlockquote = node.children.slice(1)

  return (
    <aside
      data-tt-callout=""
      data-tt-callout-kind={match.kind}
      className={`my-3 flex gap-3 rounded-md border px-3 py-2 ${style.containerClass}`}
    >
      <span className={`mt-1 flex-shrink-0 ${style.iconClass}`}>{style.icon}</span>
      <div className="flex-1">
        <p className={`text-[12px] font-semibold uppercase tracking-wide ${style.labelClass}`}>
          {style.label}
        </p>
        {remainingFirstHasContent ? (
          <Fragment key={strippedFirst.id}>{ctx.renderBlock(strippedFirst)}</Fragment>
        ) : null}
        {restOfBlockquote.map((child: BlockNode) => (
          <Fragment key={child.id}>{ctx.renderBlock(child)}</Fragment>
        ))}
      </div>
    </aside>
  )
}

export const matchesCallout = (node: BlockquoteNode): boolean => detectCallout(node) !== null

export const createCalloutPlugin = (): ReactNodeRendererPlugin<'blockquote'> => ({
  id: 'callout',
  nodeType: 'blockquote',
  priority: 20,
  matches: (node) => matchesCallout(node),
  render: (node, ctx) => {
    const match = detectCallout(node)
    if (!match) {
      return null
    }
    return <CalloutNodeRenderer node={node} ctx={ctx} match={match} />
  }
})

export const calloutPlugin: ReactNodeRendererPlugin<'blockquote'> = createCalloutPlugin()
