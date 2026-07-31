/**
 * The render-time half of the link policy (issue #478).
 *
 * The finalizer rewrites the answer once synthesis settles, which leaves a
 * window: while the answer streams, a fabricated link is already parsed, already
 * rendered, and already clickable. "The assistant never publishes a fabricated
 * documentation URL" should not be true only after the last token.
 *
 * So the same allowlist runs over every rendered snapshot, on the parsed content
 * nodes the renderer is about to mount. This is a *display* filter and never
 * touches the session source, so a link still being typed (`[text](/docs/pa`) is
 * judged again on the next snapshot rather than destroyed on the first.
 */
import type {
  BlockNode,
  ContentDocument,
  InlineNode,
  ListItemNode,
  TableCell
} from '@tinytinkerer/app-browser'
import { classifyDocumentationLink, type DocumentationSite } from './canonical-target'
import { isAuthorizedTarget, type DocumentationCitationLedger } from './citation-ledger'
import { REMOVED_LINK_TEXT } from './answer-links'

type LinkInlineNode = Extract<InlineNode, { type: 'link' }>

const isAuthorizedLink = (
  url: string,
  ledger: DocumentationCitationLedger,
  site: DocumentationSite
): boolean => {
  const classification = classifyDocumentationLink(url, site)
  return (
    classification.kind !== 'documentation' ||
    // A query string can never be authorized — no tool result produces one.
    (!classification.hasQuery && isAuthorizedTarget(ledger, classification.target))
  )
}

const inlineText = (nodes: readonly InlineNode[]): string =>
  nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'codeInline':
          return node.value
        case 'emphasis':
        case 'strong':
        case 'strikethrough':
        case 'link':
          return inlineText(node.children)
        case 'imageInline':
          return node.alt
        case 'break':
          return '\n'
      }
    })
    .join('')

/**
 * Demotes one unauthorized link.
 *
 * Its children are spliced into the parent, ids intact so React's keys survive
 * the snapshot that demoted it — except where the link text is only the URL
 * again, which would leave a plausible fake address on screen as prose. That
 * case collapses to the marker the finalizer writes, so the streamed answer and
 * the persisted one say the same thing.
 */
const demoteLink = (node: LinkInlineNode): readonly InlineNode[] => {
  const text = inlineText(node.children).trim()
  if (node.children.length === 0 || text === node.url.trim()) {
    return [{ type: 'text', ...(node.id ? { id: node.id } : {}), value: REMOVED_LINK_TEXT }]
  }
  return node.children
}

// Every helper below returns its input BY IDENTITY when nothing changed, all the
// way up to the document. An answer that cites nothing unauthorized therefore
// costs one walk and no re-render, which is what makes running this on every
// streamed snapshot affordable.
const sanitizeInline = (
  nodes: readonly InlineNode[],
  ledger: DocumentationCitationLedger,
  site: DocumentationSite
): readonly InlineNode[] => {
  let changed = false
  const next: InlineNode[] = []
  for (const node of nodes) {
    if (node.type === 'link' && !isAuthorizedLink(node.url, ledger, site)) {
      changed = true
      next.push(...demoteLink(node))
      continue
    }
    if (
      node.type === 'link' ||
      node.type === 'emphasis' ||
      node.type === 'strong' ||
      node.type === 'strikethrough'
    ) {
      const children = sanitizeInline(node.children, ledger, site)
      if (children !== node.children) {
        changed = true
        next.push({ ...node, children })
        continue
      }
    }
    next.push(node)
  }
  return changed ? next : nodes
}

const sanitizeCells = (
  cells: readonly TableCell[],
  ledger: DocumentationCitationLedger,
  site: DocumentationSite
): readonly TableCell[] => {
  const next = cells.map((cell) => sanitizeInline(cell, ledger, site))
  return next.every((cell, index) => cell === cells[index]) ? cells : next
}

const sanitizeBlocks = (
  nodes: readonly BlockNode[],
  ledger: DocumentationCitationLedger,
  site: DocumentationSite
): readonly BlockNode[] => {
  const next = nodes.map((node) => sanitizeBlock(node, ledger, site))
  return next.every((node, index) => node === nodes[index]) ? nodes : next
}

const sanitizeListItem = (
  node: ListItemNode,
  ledger: DocumentationCitationLedger,
  site: DocumentationSite
): ListItemNode => {
  const children = sanitizeBlocks(node.children, ledger, site)
  return children === node.children ? node : { ...node, children }
}

/**
 * Exhaustive by node type rather than a structural walk over any `children`
 * array: a block node added to the content contract later should fail to
 * compile here instead of silently ceasing to be sanitized.
 */
const sanitizeBlock = (
  node: BlockNode,
  ledger: DocumentationCitationLedger,
  site: DocumentationSite
): BlockNode => {
  switch (node.type) {
    case 'paragraph':
    case 'heading': {
      const children = sanitizeInline(node.children, ledger, site)
      return children === node.children ? node : { ...node, children }
    }
    case 'blockquote': {
      const children = sanitizeBlocks(node.children, ledger, site)
      return children === node.children ? node : { ...node, children }
    }
    case 'list': {
      // A list item is not a BlockNode in the content contract — it only ever
      // appears as a list's child — so it gets its own arm rather than a cast
      // into the block union.
      const children = node.children.map((item) => sanitizeListItem(item, ledger, site))
      return children.every((item, index) => item === node.children[index])
        ? node
        : { ...node, children }
    }
    case 'table': {
      const header = sanitizeCells(node.header, ledger, site)
      const rows = node.rows.map((row) => sanitizeCells(row, ledger, site))
      const rowsChanged = !rows.every((row, index) => row === node.rows[index])
      return header === node.header && !rowsChanged ? node : { ...node, header, rows }
    }
    case 'thematicBreak':
    case 'codeBlock':
    case 'choicePrompt':
    case 'image':
      // Leaves, and deliberately so. A code block is source *about* a link, and
      // an image URL is already restricted to absolute https by the renderer.
      return node
  }
}

/**
 * The rendered-content policy. Returns the document by identity when every link
 * in it is authorized, which is the overwhelmingly common case.
 */
export const sanitizeRenderedDocumentationLinks = (
  document: ContentDocument,
  ledger: DocumentationCitationLedger,
  site: DocumentationSite
): ContentDocument => {
  const nodes = sanitizeBlocks(document.nodes, ledger, site)
  return nodes === document.nodes ? document : { nodes }
}
