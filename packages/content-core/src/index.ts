export type ContentDocument = {
  nodes: ContentNode[]
}

export type MarkdownNode = {
  type: 'markdown'
  markdown: string
}

export type CodeBlockNode = {
  type: 'codeBlock'
  code: string
  language?: string
  meta?: string
}

export type MermaidNode = {
  type: 'mermaid'
  code: string
  meta?: string
}

export type WireframeNode = {
  type: 'wireframe'
  code: string
  meta?: string
}

export type ChoicePromptNode = {
  type: 'choicePrompt'
  prompt: string
  choices: string[]
}

export type TableAlignment = 'left' | 'center' | 'right' | null

export type TableNode = {
  type: 'table'
  align: TableAlignment[]
  header: string[]
  rows: string[][]
}

export type ImageNode = {
  type: 'image'
  url: string
  alt: string
  title?: string
}

export type ContentNode =
  | MarkdownNode
  | CodeBlockNode
  | MermaidNode
  | WireframeNode
  | ChoicePromptNode
  | TableNode
  | ImageNode

export type ContentNodeByType = {
  [K in ContentNode['type']]: Extract<ContentNode, { type: K }>
}

export type ContentParser<TInput = string> = (input: TInput) => ContentDocument

export type ContentRendererRegistry<TResult> = {
  [K in keyof ContentNodeByType]?: (node: ContentNodeByType[K]) => TResult
}
