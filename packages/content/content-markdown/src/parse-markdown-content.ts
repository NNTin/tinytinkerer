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
  type ThematicBreakNode
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

// A raw (unencoded) SVG data URI inside markdown image syntax:
// `![alt](data:image/svg+xml,<svg …></svg> "title")`. The destination contains
// literal `<…>` markup and spaces, so CommonMark's image-destination parser ends it
// at the first whitespace and NO image node is ever produced — the markup degrades
// to loose text. We recognise this shape up front and swap the destination for a
// sentinel data URI that parses cleanly (no spaces, no angle brackets), stashing the
// original so it can be restored onto the image node after parsing. The renderer
// then mounts the raw markup as sanitized inline SVG (it cannot ride in an `<img
// src>`). The base64 (`;base64,`) and percent-encoded (`,%3Csvg…`) forms carry no
// URL-breaking characters and already parse, so this only matches the raw form.
const RAW_SVG_IMAGE =
  /!\[([^\]]*)\]\(\s*(data:image\/svg\+xml,\s*<svg[\s\S]*?<\/svg>)\s*((?:"[^"]*"|'[^']*')?)\s*\)/gi
const RAW_SVG_SENTINEL_PREFIX = 'data:image/svg+xml,tt-raw-svg-'

type RawSvgExtraction = {
  content: string
  rawBySentinel: Map<string, string>
}

const extractRawSvgImages = (content: string): RawSvgExtraction => {
  const rawBySentinel = new Map<string, string>()
  let index = 0
  const next = content.replace(
    RAW_SVG_IMAGE,
    (_match, alt: string, dataUri: string, title: string) => {
      const sentinel = `${RAW_SVG_SENTINEL_PREFIX}${index++}`
      rawBySentinel.set(sentinel, dataUri)
      return `![${alt}](${sentinel}${title ? ` ${title}` : ''})`
    }
  )
  return { content: next, rawBySentinel }
}

const restoreRawSvgInline = (node: InlineNode, rawBySentinel: Map<string, string>): void => {
  if (node.type === 'imageInline') {
    const raw = rawBySentinel.get(node.url)
    if (raw) {
      ;(node as { url: string }).url = raw
    }
    return
  }
  if ('children' in node) {
    for (const child of node.children) {
      restoreRawSvgInline(child, rawBySentinel)
    }
  }
}

const restoreRawSvgBlock = (node: BlockNode, rawBySentinel: Map<string, string>): void => {
  switch (node.type) {
    case 'image': {
      const raw = rawBySentinel.get(node.url)
      if (raw) {
        ;(node as { url: string }).url = raw
      }
      return
    }
    case 'heading':
    case 'paragraph':
      for (const child of node.children) {
        restoreRawSvgInline(child, rawBySentinel)
      }
      return
    case 'list':
      for (const item of node.children) {
        for (const child of item.children) {
          restoreRawSvgBlock(child, rawBySentinel)
        }
      }
      return
    case 'blockquote':
      for (const child of node.children) {
        restoreRawSvgBlock(child, rawBySentinel)
      }
      return
    case 'table':
      for (const row of [node.header, ...node.rows]) {
        for (const cell of row) {
          for (const child of cell) {
            restoreRawSvgInline(child, rawBySentinel)
          }
        }
      }
      return
    default:
      return
  }
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

const inlineNodesFromTableCell = (cell: TableCell): InlineNode[] =>
  cell.children.map(inlineFromMdast)
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

const fromParagraph = (node: Paragraph, ids: IdAllocator): ParagraphNode | ImageNode => {
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

const fromCode = (node: Code, ids: IdAllocator): CodeBlockNode => {
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
  const value = (
    'value' in node && typeof node.value === 'string' ? node.value : toString(node)
  ).trim()
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
  const { content: preprocessed, rawBySentinel } = extractRawSvgImages(content)
  const root = parser.parse(preprocessed)
  const ids = createIdAllocator()
  const nodes: BlockNode[] = []

  for (const child of root.children) {
    const block = blockFromMdast(child, ids)
    if (block) {
      nodes.push(block)
    }
  }

  // Restore the raw SVG markup the sentinel stood in for, so the image node carries
  // `data:image/svg+xml,<svg …>` and the renderer can mount it as sanitized inline SVG.
  if (rawBySentinel.size > 0) {
    for (const node of nodes) {
      restoreRawSvgBlock(node, rawBySentinel)
    }
  }

  return assignNodeIds({ nodes })
}
