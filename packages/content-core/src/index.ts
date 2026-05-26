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

/**
 * Legacy escape hatch carrying raw markdown source. The semantic AST prefers
 * paragraph/heading/list/etc., but this stays exported so hand-constructed
 * documents (tests, internal tools) keep working.
 */
export type MarkdownNode = {
  type: 'markdown'
  id?: NodeId
  markdown: string
}

export type CodeBlockNode = {
  type: 'codeBlock'
  id?: NodeId
  code: string
  language?: string
  meta?: string
}

export type MermaidNode = {
  type: 'mermaid'
  id?: NodeId
  code: string
  meta?: string
}

export type WireframeNode = {
  type: 'wireframe'
  id?: NodeId
  code: string
  meta?: string
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
  | MarkdownNode
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

export type ContentParser<TInput = string> = (input: TInput) => ContentDocument

export type ContentRendererRegistry<TResult> = {
  [K in keyof ContentNodeByType]?: (node: ContentNodeByType[K]) => TResult
}
