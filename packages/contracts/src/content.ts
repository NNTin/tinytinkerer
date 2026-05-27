import { z } from 'zod'

export const nodeIdSchema = z.string()
export type NodeId = z.infer<typeof nodeIdSchema>

export type TextNode = {
  type: 'text'
  id?: NodeId | undefined
  value: string
}

export type EmphasisNode = {
  type: 'emphasis'
  id?: NodeId | undefined
  children: InlineNode[]
}

export type StrongNode = {
  type: 'strong'
  id?: NodeId | undefined
  children: InlineNode[]
}

export type StrikethroughNode = {
  type: 'strikethrough'
  id?: NodeId | undefined
  children: InlineNode[]
}

export type CodeInlineNode = {
  type: 'codeInline'
  id?: NodeId | undefined
  value: string
}

export type LinkNode = {
  type: 'link'
  id?: NodeId | undefined
  url: string
  title?: string | undefined
  children: InlineNode[]
}

export type ImageInlineNode = {
  type: 'imageInline'
  id?: NodeId | undefined
  url: string
  alt: string
  title?: string | undefined
}

export type BreakNode = {
  type: 'break'
  id?: NodeId | undefined
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
  id?: NodeId | undefined
  level: 1 | 2 | 3 | 4 | 5 | 6
  children: InlineNode[]
}

export type ParagraphNode = {
  type: 'paragraph'
  id?: NodeId | undefined
  children: InlineNode[]
}

export type ListItemNode = {
  type: 'listItem'
  id?: NodeId | undefined
  checked?: boolean | null | undefined
  children: BlockNode[]
}

export type ListNode = {
  type: 'list'
  id?: NodeId | undefined
  ordered: boolean
  start?: number | undefined
  children: ListItemNode[]
}

export type BlockquoteNode = {
  type: 'blockquote'
  id?: NodeId | undefined
  children: BlockNode[]
}

export type ThematicBreakNode = {
  type: 'thematicBreak'
  id?: NodeId | undefined
}

export type CodeBlockNode = {
  type: 'codeBlock'
  id?: NodeId | undefined
  code: string
  language?: string | undefined
}

export type ChoicePromptNode = {
  type: 'choicePrompt'
  id?: NodeId | undefined
  prompt: string
  choices: string[]
}

export type TableAlignment = 'left' | 'center' | 'right' | null
export type TableCell = InlineNode[]

export type TableNode = {
  type: 'table'
  id?: NodeId | undefined
  align: TableAlignment[]
  header: TableCell[]
  rows: TableCell[][]
}

export type ImageNode = {
  type: 'image'
  id?: NodeId | undefined
  url: string
  alt: string
  title?: string | undefined
}

export type BlockNode =
  | HeadingNode
  | ParagraphNode
  | ListNode
  | BlockquoteNode
  | ThematicBreakNode
  | CodeBlockNode
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

export const inlineNodeSchema: z.ZodType<InlineNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      id: nodeIdSchema.optional(),
      value: z.string()
    }),
    z.object({
      type: z.literal('emphasis'),
      id: nodeIdSchema.optional(),
      children: z.array(inlineNodeSchema)
    }),
    z.object({
      type: z.literal('strong'),
      id: nodeIdSchema.optional(),
      children: z.array(inlineNodeSchema)
    }),
    z.object({
      type: z.literal('strikethrough'),
      id: nodeIdSchema.optional(),
      children: z.array(inlineNodeSchema)
    }),
    z.object({
      type: z.literal('codeInline'),
      id: nodeIdSchema.optional(),
      value: z.string()
    }),
    z.object({
      type: z.literal('link'),
      id: nodeIdSchema.optional(),
      url: z.string(),
      title: z.string().optional(),
      children: z.array(inlineNodeSchema)
    }),
    z.object({
      type: z.literal('imageInline'),
      id: nodeIdSchema.optional(),
      url: z.string(),
      alt: z.string(),
      title: z.string().optional()
    }),
    z.object({
      type: z.literal('break'),
      id: nodeIdSchema.optional()
    })
  ])
)

export const tableCellSchema: z.ZodType<TableCell> = z.array(inlineNodeSchema)

export const tableAlignmentSchema: z.ZodType<TableAlignment> = z.union([
  z.literal('left'),
  z.literal('center'),
  z.literal('right'),
  z.null()
])

export const blockNodeSchema: z.ZodType<BlockNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('heading'),
      id: nodeIdSchema.optional(),
      level: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6)
      ]),
      children: z.array(inlineNodeSchema)
    }),
    z.object({
      type: z.literal('paragraph'),
      id: nodeIdSchema.optional(),
      children: z.array(inlineNodeSchema)
    }),
    z.object({
      type: z.literal('list'),
      id: nodeIdSchema.optional(),
      ordered: z.boolean(),
      start: z.number().int().optional(),
      children: z.array(listItemNodeSchema)
    }),
    z.object({
      type: z.literal('blockquote'),
      id: nodeIdSchema.optional(),
      children: z.array(blockNodeSchema)
    }),
    z.object({
      type: z.literal('thematicBreak'),
      id: nodeIdSchema.optional()
    }),
    z.object({
      type: z.literal('codeBlock'),
      id: nodeIdSchema.optional(),
      code: z.string(),
      language: z.string().optional()
    }),
    z.object({
      type: z.literal('choicePrompt'),
      id: nodeIdSchema.optional(),
      prompt: z.string(),
      choices: z.array(z.string())
    }),
    z.object({
      type: z.literal('table'),
      id: nodeIdSchema.optional(),
      align: z.array(tableAlignmentSchema),
      header: z.array(tableCellSchema),
      rows: z.array(z.array(tableCellSchema))
    }),
    z.object({
      type: z.literal('image'),
      id: nodeIdSchema.optional(),
      url: z.string(),
      alt: z.string(),
      title: z.string().optional()
    })
  ])
)

export const listItemNodeSchema: z.ZodType<ListItemNode> = z.lazy(() =>
  z.object({
    type: z.literal('listItem'),
    id: nodeIdSchema.optional(),
    checked: z.boolean().nullable().optional(),
    children: z.array(blockNodeSchema)
  })
)

export const contentDocumentSchema: z.ZodType<ContentDocument> = z.object({
  nodes: z.array(blockNodeSchema)
})

export type AssistantInlineNode = InlineNode
export type AssistantTableCell = TableCell
export type AssistantTableAlignment = TableAlignment
export type AssistantListItemNode = ListItemNode
export type AssistantBlockNode = BlockNode
export type AssistantContentDocument = ContentDocument

export const assistantInlineNodeSchema = inlineNodeSchema
export const assistantTableCellSchema = tableCellSchema
export const assistantTableAlignmentSchema = tableAlignmentSchema
export const assistantListItemNodeSchema = listItemNodeSchema
export const assistantBlockNodeSchema = blockNodeSchema
export const assistantContentDocumentSchema = contentDocumentSchema
