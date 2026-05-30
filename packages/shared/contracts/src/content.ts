import { z } from 'zod'

export const nodeIdSchema = z.string()
export type NodeId = z.infer<typeof nodeIdSchema>

export const tableAlignmentSchema = z.union([
  z.literal('left'),
  z.literal('center'),
  z.literal('right'),
  z.null()
])
export type TableAlignment = z.infer<typeof tableAlignmentSchema>

const headingLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6)
])
type HeadingLevel = z.infer<typeof headingLevelSchema>

interface NodeBase {
  id?: NodeId
}

export interface TextNode extends NodeBase {
  type: 'text'
  value: string
}

export interface EmphasisNode extends NodeBase {
  type: 'emphasis'
  children: readonly InlineNode[]
}

export interface StrongNode extends NodeBase {
  type: 'strong'
  children: readonly InlineNode[]
}

export interface StrikethroughNode extends NodeBase {
  type: 'strikethrough'
  children: readonly InlineNode[]
}

export interface CodeInlineNode extends NodeBase {
  type: 'codeInline'
  value: string
}

export interface LinkNode extends NodeBase {
  type: 'link'
  url: string
  title?: string
  children: readonly InlineNode[]
}

export interface ImageInlineNode extends NodeBase {
  type: 'imageInline'
  url: string
  alt: string
  title?: string
}

export interface BreakNode extends NodeBase {
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

export type TableCell = readonly InlineNode[]

export interface HeadingNode extends NodeBase {
  type: 'heading'
  level: HeadingLevel
  children: readonly InlineNode[]
}

export interface ParagraphNode extends NodeBase {
  type: 'paragraph'
  children: readonly InlineNode[]
}

export interface ListItemNode extends NodeBase {
  type: 'listItem'
  checked?: boolean | null
  children: readonly BlockNode[]
}

export interface ListNode extends NodeBase {
  type: 'list'
  ordered: boolean
  start?: number
  children: readonly ListItemNode[]
}

export interface BlockquoteNode extends NodeBase {
  type: 'blockquote'
  children: readonly BlockNode[]
}

export interface ThematicBreakNode extends NodeBase {
  type: 'thematicBreak'
}

export interface CodeBlockNode extends NodeBase {
  type: 'codeBlock'
  code: string
  language?: string
}

export interface ChoicePromptNode extends NodeBase {
  type: 'choicePrompt'
  prompt: string
  choices: readonly string[]
}

export interface TableNode extends NodeBase {
  type: 'table'
  align: readonly TableAlignment[]
  header: readonly TableCell[]
  rows: readonly (readonly TableCell[])[]
}

export interface ImageNode extends NodeBase {
  type: 'image'
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
  | ChoicePromptNode
  | TableNode
  | ImageNode

export type ContentNode = BlockNode

export type ContentNodeByType = {
  [K in ContentNode['type']]: Extract<ContentNode, { type: K }>
}

const nodeBaseShape = {
  id: nodeIdSchema.optional()
} as const

const inlineChildren = z.array(z.lazy(() => inlineNodeSchema)).readonly()
const blockChildren = z.array(z.lazy(() => blockNodeSchema)).readonly()

export const inlineNodeSchema = z.discriminatedUnion('type', [
  z.object({
    ...nodeBaseShape,
    type: z.literal('text'),
    value: z.string()
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('emphasis'),
    children: inlineChildren
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('strong'),
    children: inlineChildren
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('strikethrough'),
    children: inlineChildren
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('codeInline'),
    value: z.string()
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('link'),
    url: z.string(),
    title: z.string().optional(),
    children: inlineChildren
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('imageInline'),
    url: z.string(),
    alt: z.string(),
    title: z.string().optional()
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('break')
  })
]) as unknown as z.ZodType<InlineNode>

export const tableCellSchema: z.ZodType<TableCell> = z.array(inlineNodeSchema).readonly()

export const listItemNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('listItem'),
  checked: z.boolean().nullable().optional(),
  children: blockChildren
}) as unknown as z.ZodType<ListItemNode>

export const blockNodeSchema = z.discriminatedUnion('type', [
  z.object({
    ...nodeBaseShape,
    type: z.literal('heading'),
    level: headingLevelSchema,
    children: z.array(inlineNodeSchema).readonly()
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('paragraph'),
    children: z.array(inlineNodeSchema).readonly()
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('list'),
    ordered: z.boolean(),
    start: z.number().int().optional(),
    children: z.array(listItemNodeSchema).readonly()
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('blockquote'),
    children: blockChildren
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('thematicBreak')
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('codeBlock'),
    code: z.string(),
    language: z.string().optional()
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('choicePrompt'),
    prompt: z.string(),
    choices: z.array(z.string()).readonly()
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('table'),
    align: z.array(tableAlignmentSchema).readonly(),
    header: z.array(tableCellSchema).readonly(),
    rows: z.array(z.array(tableCellSchema).readonly()).readonly()
  }),
  z.object({
    ...nodeBaseShape,
    type: z.literal('image'),
    url: z.string(),
    alt: z.string(),
    title: z.string().optional()
  })
]) as unknown as z.ZodType<BlockNode>

export const contentDocumentSchema = z.object({
  nodes: z.array(blockNodeSchema).readonly()
})
export type ContentDocument = z.infer<typeof contentDocumentSchema>
