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

// An SVG data URI inside markdown image syntax can contain URL-breaking characters:
// `![alt](data:image/svg+xml,<svg …></svg> "title")`, or the common hybrid shape
// `![alt](data:image/svg+xml,%3Csvg … %3C/svg%3E)`, where markup-significant
// characters are percent-encoded but attribute separators remain literal spaces.
// CommonMark's image-destination parser ends an unwrapped destination at the first
// whitespace, so no image node is produced and the markup degrades to loose text.
// We recognise these shapes up front and swap the destination for a sentinel data
// URI that parses cleanly, stashing a normalized raw-SVG URI so it can be restored
// onto the image node after parsing. The renderer then mounts the raw markup as
// sanitized inline SVG (it cannot ride in an `<img src>`). Fully URL-safe base64
// (`;base64,`) and percent-encoded (`%3Csvg%3E…`) forms already parse, so they are
// left untouched unless literal URL-breaking characters are present.
//
// We deliberately avoid one all-in-one regex here: a pattern like
// `!\[[^\]]*\]\(…<svg[\s\S]*?<\/svg>…\)` is polynomial-ReDoS-prone — the alt's `[^\]]*`
// rescans from every `![`, and the lazy body rescans from every `<svg`, so adversarial
// input (`![` ×n, or `![](data:image/svg+xml,<svg` ×n) is O(n²). Instead we ANCHOR on
// the rare literal scheme with an all-literal regex (linear, no backtracking), scan
// for a raw-or-percent-encoded `</svg>` close monotonically, and validate the
// surrounding `![alt](… )` with plain index scans, so every character is visited O(1)
// times overall.
const RAW_SVG_SCHEME = /data:image\/svg\+xml,/gi
const RAW_SVG_SENTINEL_PREFIX = 'data:image/svg+xml,tt-raw-svg-'
const RAW_SVG_DATA_URI_PREFIX = 'data:image/svg+xml,'
const SVG_OPEN = '<svg'
const SVG_CLOSE = '</svg>'
const HEX_BYTE = /^[\da-f]{2}$/i

type RawSvgExtraction = {
  content: string
  rawBySentinel: Map<string, string>
}

const isInlineWhitespace = (ch: string | undefined): boolean =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'

type DecodedChar = {
  ch: string
  next: number
}

type SvgCloseMatch = {
  start: number
  end: number
}

const readDecodedChar = (content: string, index: number): DecodedChar | null => {
  if (index >= content.length) return null

  const ch = content[index] ?? ''
  const hex = content.slice(index + 1, index + 3)
  if (ch === '%' && HEX_BYTE.test(hex)) {
    return { ch: String.fromCharCode(Number.parseInt(hex, 16)), next: index + 3 }
  }

  return { ch, next: index + 1 }
}

const readDecodedPrefix = (content: string, from: number, length: number): string => {
  let prefix = ''
  let index = from
  while (prefix.length < length) {
    const decoded = readDecodedChar(content, index)
    if (!decoded) break
    prefix += decoded.ch
    index = decoded.next
  }
  return prefix
}

const startsDecodedSvgOpen = (content: string, from: number): boolean => {
  const prefix = readDecodedPrefix(content, from, SVG_OPEN.length + 1)
  if (prefix.slice(0, SVG_OPEN.length).toLowerCase() !== SVG_OPEN) return false

  const next = prefix[SVG_OPEN.length]
  return next === undefined || next === '>' || isInlineWhitespace(next)
}

const findDecodedSvgClose = (content: string, from: number): SvgCloseMatch | null => {
  let index = from
  let matched = 0
  let start = -1

  while (index < content.length) {
    const charStart = index
    const decoded = readDecodedChar(content, index)
    if (!decoded) return null

    const ch = decoded.ch.toLowerCase()
    if (ch === SVG_CLOSE[matched]) {
      if (matched === 0) start = charStart
      matched += 1
      if (matched === SVG_CLOSE.length) {
        return { start, end: decoded.next }
      }
    } else if (ch === SVG_CLOSE[0]) {
      matched = 1
      start = charStart
    } else {
      matched = 0
      start = -1
    }

    index = decoded.next
  }

  return null
}

const hasUnbalancedLiteralParens = (value: string): boolean => {
  let depth = 0
  for (const ch of value) {
    if (ch === '(') {
      depth += 1
    } else if (ch === ')') {
      if (depth === 0) return true
      depth -= 1
    }
  }
  return depth !== 0
}

const hasLiteralUrlBreakingCharacters = (dataUriBody: string): boolean =>
  /[\s<>]/.test(dataUriBody) || hasUnbalancedLiteralParens(dataUriBody)

const decodeSvgDataUriBody = (body: string): string => {
  try {
    return decodeURIComponent(body)
  } catch {
    try {
      // Raw SVG bodies can legitimately contain `%` text (for example `width="100%"`).
      // Escape only malformed percent signs, then let the platform decoder preserve
      // UTF-8 sequences instead of hand-decoding byte-by-byte.
      return decodeURIComponent(body.replace(/%(?![\da-f]{2})/gi, '%25'))
    } catch {
      return body.replace(/%([\da-f]{2})/gi, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      )
    }
  }
}

const extractRawSvgImages = (content: string): RawSvgExtraction => {
  const rawBySentinel = new Map<string, string>()
  // Cheap pre-gate: skip the whole pass unless an SVG data URI scheme is present at all.
  if (!/data:image\/svg\+xml,/i.test(content)) {
    return { content, rawBySentinel }
  }

  let result = ''
  let copiedUpTo = 0 // everything before this index is already flushed to `result`
  let sentinelIndex = 0

  // Monotonic cache for the forward raw-or-percent-encoded `</svg>` search: `from`
  // only ever increases across matches, so the first close at-or-after an earlier
  // `from` is still the first one for any later `from` that hasn't passed it. This
  // keeps repeated lookups linear even when many `<svg` openings precede one close.
  let cachedClose: SvgCloseMatch | null | undefined
  let cachedFrom = 0
  const findSvgClose = (from: number): SvgCloseMatch | null => {
    if (cachedClose === null && from >= cachedFrom) return null
    if (cachedClose && cachedClose.start >= from && cachedFrom <= from) return cachedClose
    cachedFrom = from
    cachedClose = findDecodedSvgClose(content, from)
    return cachedClose
  }

  for (const match of content.matchAll(RAW_SVG_SCHEME)) {
    const schemeStart = match.index
    if (schemeStart < copiedUpTo) continue // inside an image we already consumed

    // Raw or partially percent-encoded form: optional whitespace then decoded `<svg`
    // right after the comma.
    let bodyStart = schemeStart + match[0].length
    while (isInlineWhitespace(content[bodyStart])) bodyStart += 1
    if (!startsDecodedSvgOpen(content, bodyStart)) continue

    // The destination must open with `(` (optionally preceded by whitespace), and the
    // alt must close with `]` just before it.
    let i = schemeStart - 1
    while (i >= copiedUpTo && isInlineWhitespace(content[i])) i -= 1
    if (i < copiedUpTo || content[i] !== '(') continue
    i -= 1
    if (i < copiedUpTo || content[i] !== ']') continue
    const altEnd = i

    // Walk back to the matching `![` (markdown image alt contains no unescaped `]`).
    let open = -1
    for (let j = altEnd - 1; j >= copiedUpTo; j -= 1) {
      const ch = content[j]
      if (ch === ']') break
      if (ch === '[' && j > 0 && content[j - 1] === '!') {
        open = j - 1
        break
      }
    }
    if (open === -1) continue

    // Find the SVG close, then the image close `)` (skipping an optional quoted title,
    // which may itself contain a `)`).
    const svgClose = findSvgClose(bodyStart)
    if (!svgClose) break // no close anywhere ahead — nothing left to match
    const dataUriEnd = svgClose.end
    const originalBody = content.slice(bodyStart, dataUriEnd)
    if (!hasLiteralUrlBreakingCharacters(originalBody)) continue

    let k = dataUriEnd
    while (isInlineWhitespace(content[k])) k += 1
    const quote = content[k]
    if (quote === '"' || quote === "'") {
      const titleClose = content.indexOf(quote, k + 1)
      if (titleClose === -1) continue
      k = titleClose + 1
      while (isInlineWhitespace(content[k])) k += 1
    }
    if (content[k] !== ')') continue

    const alt = content.slice(open + 2, altEnd)
    const title = content.slice(dataUriEnd, k).trim() // quoted title, or '' if none
    const sentinel = `${RAW_SVG_SENTINEL_PREFIX}${sentinelIndex++}`
    rawBySentinel.set(sentinel, `${RAW_SVG_DATA_URI_PREFIX}${decodeSvgDataUriBody(originalBody)}`)
    result += content.slice(copiedUpTo, open)
    result += `![${alt}](${sentinel}${title ? ` ${title}` : ''})`
    copiedUpTo = k + 1
  }

  result += content.slice(copiedUpTo)
  return { content: result, rawBySentinel }
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
