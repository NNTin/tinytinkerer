import { toString } from 'mdast-util-to-string'
import type {
  BlockContent,
  Blockquote,
  Code,
  Heading,
  Image,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  RootContent,
  Table,
  TableCell,
  ThematicBreak
} from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import {
  assignNodeIds,
  computeNodeId,
  type BlockNode,
  type BlockquoteNode,
  type CodeBlockNode,
  type ContentDocument,
  type HeadingNode,
  type ImageNode,
  type InlineNode,
  type ListItemNode,
  type ListNode,
  type NodeId,
  type ParagraphNode,
  type TableAlignment,
  type TableNode,
  type ThematicBreakNode,
} from '@tinytinkerer/content-core'
import { unified } from 'unified'

const parser = unified().use(remarkParse).use(remarkGfm)

type IdAllocator = {
  allocate: (type: string, digest: string) => NodeId
}

const createIdAllocator = (): IdAllocator => {
  const counts = new Map<string, number>()
  return {
    allocate: (type, digest) => {
      const key = `${type}\u0000${digest}`
      const occurrence = counts.get(key) ?? 0
      counts.set(key, occurrence + 1)
      return computeNodeId(type, digest, occurrence)
    }
  }
}

const sanitizeImageUrl = (url: string): string => {
  if (/^https?:/i.test(url)) return url
  if (/^data:image\//i.test(url)) return url
  return ''
}

const sanitizeLinkUrl = (url: string): string => {
  const trimmed = url.trim()
  if (!trimmed) return ''

  const schemeMatch = /^([a-z][a-z\d+\-.]*):/i.exec(trimmed)
  if (!schemeMatch) {
    return trimmed.startsWith('//') ? '' : trimmed
  }

  const scheme = schemeMatch[1]?.toLowerCase()
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel'
    ? trimmed
    : ''
}

const inlineFromMdast = (node: PhrasingContent): InlineNode => {
  switch (node.type) {
    case 'text':
      return { type: 'text', value: node.value }
    case 'emphasis':
      return { type: 'emphasis', children: node.children.map(inlineFromMdast) }
    case 'strong':
      return { type: 'strong', children: node.children.map(inlineFromMdast) }
    case 'delete':
      return { type: 'strikethrough', children: node.children.map(inlineFromMdast) }
    case 'inlineCode':
      return { type: 'codeInline', value: node.value }
    case 'link':
      return {
        type: 'link',
        url: sanitizeLinkUrl(node.url),
        ...(node.title ? { title: node.title } : {}),
        children: node.children.map(inlineFromMdast)
      }
    case 'image':
      return {
        type: 'imageInline',
        url: sanitizeImageUrl(node.url),
        alt: node.alt ?? '',
        ...(node.title ? { title: node.title } : {})
      }
    case 'break':
      return { type: 'break' }
    default:
      return { type: 'text', value: toString(node) }
  }
}

const inlineNodesFromTableCell = (cell: TableCell): InlineNode[] => cell.children.map(inlineFromMdast)
const inlineCellDigest = (cell: InlineNode[]): string => JSON.stringify(cell)

const fromHeading = (node: Heading, ids: IdAllocator): HeadingNode => ({
  type: 'heading',
  id: ids.allocate('heading', toString(node)),
  level: node.depth,
  children: node.children.map(inlineFromMdast)
})

const fromStandaloneImage = (node: Image, ids: IdAllocator): ImageNode => ({
  type: 'image',
  id: ids.allocate('image', node.url),
  url: sanitizeImageUrl(node.url),
  alt: node.alt ?? '',
  ...(node.title ? { title: node.title } : {})
})

const fromParagraph = (
  node: Paragraph,
  ids: IdAllocator
): ParagraphNode | ImageNode => {
  if (node.children.length === 1 && node.children[0]?.type === 'image') {
    return fromStandaloneImage(node.children[0], ids)
  }
  return {
    type: 'paragraph',
    id: ids.allocate('paragraph', toString(node)),
    children: node.children.map(inlineFromMdast)
  }
}

const fromListItem = (node: ListItem, ids: IdAllocator): ListItemNode => {
  const item: ListItemNode = {
    type: 'listItem',
    id: ids.allocate('listItem', toString(node)),
    children: node.children.flatMap((child): BlockNode[] => {
      const block = blockFromMdast(child, ids)
      return block ? [block] : []
    })
  }
  if (typeof node.checked === 'boolean') {
    item.checked = node.checked
  }
  return item
}

const fromList = (node: List, ids: IdAllocator): ListNode => {
  const list: ListNode = {
    type: 'list',
    id: ids.allocate('list', toString(node)),
    ordered: Boolean(node.ordered),
    children: node.children.map((item) => fromListItem(item, ids))
  }
  if (typeof node.start === 'number') {
    list.start = node.start
  }
  return list
}

const fromBlockquote = (node: Blockquote, ids: IdAllocator): BlockquoteNode => ({
  type: 'blockquote',
  id: ids.allocate('blockquote', toString(node)),
  children: node.children.flatMap((child): BlockNode[] => {
    const block = blockFromMdast(child, ids)
    return block ? [block] : []
  })
})

const fromThematicBreak = (_: ThematicBreak, ids: IdAllocator): ThematicBreakNode => ({
  type: 'thematicBreak',
  id: ids.allocate('thematicBreak', '')
})

const fromCode = (
  node: Code,
  ids: IdAllocator
): CodeBlockNode => {
  const block: CodeBlockNode = {
    type: 'codeBlock',
    id: ids.allocate('codeBlock', `${node.lang ?? ''}\u0000${node.value}`),
    code: node.value
  }
  if (node.lang) {
    block.language = node.lang
  }
  return block
}

const fromTable = (node: Table, ids: IdAllocator): TableNode => {
  const headerRow = node.children[0]
  const bodyRows = node.children.slice(1)
  const align = (node.align ?? []).map((value): TableAlignment => value ?? null)
  const header = headerRow ? headerRow.children.map(inlineNodesFromTableCell) : []
  const rows = bodyRows.map((row) => row.children.map(inlineNodesFromTableCell))
  const digest = [
    header.map(inlineCellDigest).join('\u0001'),
    ...rows.map((row) => row.map(inlineCellDigest).join('\u0001'))
  ].join('\n')
  return {
    type: 'table',
    id: ids.allocate('table', digest),
    align,
    header,
    rows
  }
}

const fallbackParagraphFromUnsupported = (
  node: RootContent | BlockContent,
  ids: IdAllocator
): ParagraphNode | null => {
  const value = ('value' in node && typeof node.value === 'string' ? node.value : toString(node)).trim()
  if (!value) {
    return null
  }
  return {
    type: 'paragraph',
    id: ids.allocate('paragraph', value),
    children: [{ type: 'text', value }]
  }
}

const blockFromMdast = (node: RootContent | BlockContent, ids: IdAllocator): BlockNode | null => {
  switch (node.type) {
    case 'heading':
      return fromHeading(node, ids)
    case 'paragraph':
      return fromParagraph(node, ids)
    case 'list':
      return fromList(node, ids)
    case 'blockquote':
      return fromBlockquote(node, ids)
    case 'thematicBreak':
      return fromThematicBreak(node, ids)
    case 'code':
      return fromCode(node, ids)
    case 'table':
      return fromTable(node, ids)
    default:
      return fallbackParagraphFromUnsupported(node, ids)
  }
}

export const parseMarkdownContent = (content: string): ContentDocument => {
  const root = parser.parse(content)
  const ids = createIdAllocator()
  const nodes: BlockNode[] = []

  for (const child of root.children) {
    const block = blockFromMdast(child, ids)
    if (block) {
      nodes.push(block)
    }
  }

  return assignNodeIds({ nodes })
}
