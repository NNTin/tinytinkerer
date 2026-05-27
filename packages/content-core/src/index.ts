export type NodeId = string

const djb2 = (input: string): number => {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = (((hash << 5) + hash) ^ input.charCodeAt(i)) >>> 0
  }
  return hash
}

export const hashContent = (input: string): string => djb2(input).toString(16)

export const computeNodeId = (
  type: string,
  contentDigest: string,
  occurrence: number
): NodeId => `${type}-${hashContent(contentDigest)}-${occurrence}`

export type TextNode = {
  type: 'text'
  value: string
}

export type EmphasisNode = {
  type: 'emphasis'
  children: InlineNode[]
}

export type StrongNode = {
  type: 'strong'
  children: InlineNode[]
}

export type StrikethroughNode = {
  type: 'strikethrough'
  children: InlineNode[]
}

export type CodeInlineNode = {
  type: 'codeInline'
  value: string
}

export type LinkNode = {
  type: 'link'
  url: string
  title?: string
  children: InlineNode[]
}

export type ImageInlineNode = {
  type: 'imageInline'
  url: string
  alt: string
  title?: string
}

export type BreakNode = {
  type: 'break'
}

export type InlineNode =
  | TextNode
  | EmphasisNode
  | StrongNode
  | StrikethroughNode
  | CodeInlineNode
  | LinkNode
  | ImageInlineNode
  | BreakNode

export type HeadingNode = {
  type: 'heading'
  id?: NodeId
  level: 1 | 2 | 3 | 4 | 5 | 6
  children: InlineNode[]
}

export type ParagraphNode = {
  type: 'paragraph'
  id?: NodeId
  children: InlineNode[]
}

export type ListItemNode = {
  type: 'listItem'
  id?: NodeId
  checked?: boolean | null
  children: BlockNode[]
}

export type ListNode = {
  type: 'list'
  id?: NodeId
  ordered: boolean
  start?: number
  children: ListItemNode[]
}

export type BlockquoteNode = {
  type: 'blockquote'
  id?: NodeId
  children: BlockNode[]
}

export type ThematicBreakNode = {
  type: 'thematicBreak'
  id?: NodeId
}

export type CodeBlockNode = {
  type: 'codeBlock'
  id?: NodeId
  code: string
  language?: string
}

export type MermaidNode = {
  type: 'mermaid'
  id?: NodeId
  code: string
}

export type WireframeNode = {
  type: 'wireframe'
  id?: NodeId
  code: string
}

export type ChoicePromptNode = {
  type: 'choicePrompt'
  id?: NodeId
  prompt: string
  choices: string[]
}

export type TableAlignment = 'left' | 'center' | 'right' | null

export type TableNode = {
  type: 'table'
  id?: NodeId
  align: TableAlignment[]
  header: string[]
  rows: string[][]
}

export type ImageNode = {
  type: 'image'
  id?: NodeId
  url: string
  alt: string
  title?: string
}

export type BlockNode =
  | HeadingNode
  | ParagraphNode
  | ListNode
  | BlockquoteNode
  | ThematicBreakNode
  | CodeBlockNode
  | MermaidNode
  | WireframeNode
  | ChoicePromptNode
  | TableNode
  | ImageNode

export type ContentNode = BlockNode

export type ContentDocument = {
  nodes: BlockNode[]
}

export type ContentNodeByType = {
  [K in ContentNode['type']]: Extract<ContentNode, { type: K }>
}

const serializeInlineNode = (node: InlineNode): string => {
  switch (node.type) {
    case 'text':
      return `text:${node.value}`
    case 'emphasis':
      return `emphasis(${node.children.map(serializeInlineNode).join('|')})`
    case 'strong':
      return `strong(${node.children.map(serializeInlineNode).join('|')})`
    case 'strikethrough':
      return `strikethrough(${node.children.map(serializeInlineNode).join('|')})`
    case 'codeInline':
      return `codeInline:${node.value}`
    case 'link':
      return `link:${node.url}:${node.title ?? ''}(${node.children.map(serializeInlineNode).join('|')})`
    case 'imageInline':
      return `imageInline:${node.url}:${node.alt}:${node.title ?? ''}`
    case 'break':
      return 'break'
  }
}

const serializeInlineNodes = (nodes: InlineNode[]): string => nodes.map(serializeInlineNode).join('\n')

const serializeListItem = (node: ListItemNode): string =>
  `listItem:${node.checked === undefined ? '' : String(node.checked)}:${node.children.map(serializeBlockNode).join('\n')}`

const serializeBlockNode = (node: BlockNode): string => {
  switch (node.type) {
    case 'heading':
      return `heading:${node.level}:${serializeInlineNodes(node.children)}`
    case 'paragraph':
      return `paragraph:${serializeInlineNodes(node.children)}`
    case 'list':
      return `list:${String(node.ordered)}:${node.start ?? ''}:${node.children.map(serializeListItem).join('\n')}`
    case 'blockquote':
      return `blockquote:${node.children.map(serializeBlockNode).join('\n')}`
    case 'thematicBreak':
      return 'thematicBreak'
    case 'codeBlock':
      return `codeBlock:${node.language ?? ''}:${node.code}`
    case 'mermaid':
      return `mermaid:${node.code}`
    case 'wireframe':
      return `wireframe:${node.code}`
    case 'choicePrompt':
      return `choicePrompt:${node.prompt}:${node.choices.join('\n')}`
    case 'table':
      return `table:${node.align.join('|')}:${node.header.join('|')}:${node.rows.map((row) => row.join('|')).join('\n')}`
    case 'image':
      return `image:${node.url}:${node.alt}:${node.title ?? ''}`
  }
}

const nextOccurrence = (counts: Map<string, number>, type: string, digest: string): number => {
  const key = `${type}\u0000${digest}`
  const occurrence = counts.get(key) ?? 0
  counts.set(key, occurrence + 1)
  return occurrence
}

const withAssignedId = <T extends { type: string; id?: NodeId }>(
  node: T,
  counts: Map<string, number>,
  digest: string
): T => {
  const occurrence = nextOccurrence(counts, node.type, digest)
  if (node.id) {
    return node
  }
  return {
    ...node,
    id: computeNodeId(node.type, digest, occurrence)
  }
}

const normalizeListItem = (
  node: ListItemNode,
  counts: Map<string, number>
): ListItemNode => {
  const children = node.children.map((child) => normalizeBlockNode(child, counts))
  const normalized = {
    ...node,
    children
  }
  return withAssignedId(normalized, counts, serializeListItem(normalized))
}

const normalizeBlockNode = (
  node: BlockNode,
  counts: Map<string, number>
): BlockNode => {
  switch (node.type) {
    case 'list': {
      const children = node.children.map((child) => normalizeListItem(child, counts))
      const normalized: ListNode = {
        ...node,
        children
      }
      return withAssignedId(normalized, counts, serializeBlockNode(normalized))
    }
    case 'blockquote': {
      const children = node.children.map((child) => normalizeBlockNode(child, counts))
      const normalized: BlockquoteNode = {
        ...node,
        children
      }
      return withAssignedId(normalized, counts, serializeBlockNode(normalized))
    }
    default:
      return withAssignedId(node, counts, serializeBlockNode(node))
  }
}

export const assignNodeIds = (document: ContentDocument): ContentDocument => {
  const counts = new Map<string, number>()
  return {
    nodes: document.nodes.map((node) => normalizeBlockNode(node, counts))
  }
}
