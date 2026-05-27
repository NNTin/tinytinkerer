import type {
  InlineNode,
  ParagraphNode,
  ReactNodeRendererPlugin
} from '@tinytinkerer/content-react'

type LinkCardSource = {
  readonly url: string
  readonly displayText: string | null
}

const inlineToText = (nodes: readonly InlineNode[]): string => {
  let text = ''
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'codeInline') {
      text += node.value
    } else if (
      node.type === 'emphasis' ||
      node.type === 'strong' ||
      node.type === 'strikethrough' ||
      node.type === 'link'
    ) {
      text += inlineToText(node.children)
    } else if (node.type === 'imageInline') {
      text += node.alt
    } else if (node.type === 'break') {
      text += '\n'
    }
  }
  return text
}

const tryParseUrl = (value: string): URL | null => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const detectLinkCard = (node: ParagraphNode): LinkCardSource | null => {
  const onlyChild = node.children.length === 1 ? node.children[0] : null
  if (!onlyChild) {
    return null
  }
  if (onlyChild.type === 'link') {
    const parsed = tryParseUrl(onlyChild.url)
    if (!parsed) {
      return null
    }
    const displayText = inlineToText(onlyChild.children).trim()
    return {
      url: onlyChild.url,
      displayText: displayText.length > 0 ? displayText : null
    }
  }
  if (onlyChild.type === 'text') {
    const trimmed = onlyChild.value.trim()
    if (trimmed.length === 0) {
      return null
    }
    const parsed = tryParseUrl(trimmed)
    if (!parsed) {
      return null
    }
    return { url: trimmed, displayText: null }
  }
  return null
}

const buildTitle = (source: LinkCardSource): string => {
  if (source.displayText) {
    return source.displayText
  }
  const parsed = tryParseUrl(source.url)
  if (!parsed) {
    return source.url
  }
  const path = parsed.pathname === '/' ? '' : parsed.pathname
  return `${parsed.hostname}${path}`
}

const buildHostname = (url: string): string => {
  const parsed = tryParseUrl(url)
  return parsed ? parsed.hostname : url
}

const ExternalLinkIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth="2"
    stroke="currentColor"
    className="h-4 w-4"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13 7l5 5m0 0l-5 5m5-5H6"
    />
  </svg>
)

export const LinkCardNodeRenderer = ({ source }: { source: LinkCardSource }) => {
  const title = buildTitle(source)
  const hostname = buildHostname(source.url)

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer noopener"
      data-tt-link-card=""
      className="my-2 flex items-center justify-between gap-3 rounded-md border border-stone-200 bg-white px-3 py-2 no-underline transition-colors hover:border-stone-300 hover:bg-stone-50"
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium text-stone-900">{title}</span>
        <span className="truncate text-[11px] text-stone-500">{hostname}</span>
      </span>
      <span className="flex-shrink-0 text-stone-400">
        <ExternalLinkIcon />
      </span>
    </a>
  )
}

export const matchesLinkCard = (node: ParagraphNode): boolean => detectLinkCard(node) !== null

export const createLinkCardPlugin = (): ReactNodeRendererPlugin<'paragraph'> => ({
  id: 'link-card',
  nodeType: 'paragraph',
  priority: 20,
  matches: (node) => matchesLinkCard(node),
  render: (node) => {
    const source = detectLinkCard(node)
    if (!source) {
      return null
    }
    return <LinkCardNodeRenderer source={source} />
  }
})

export const linkCardPlugin: ReactNodeRendererPlugin<'paragraph'> = createLinkCardPlugin()
