import type {
  AssistantBlockNode,
  AssistantContentDocument,
  AssistantInlineNode,
  AssistantListItemNode
} from '@tinytinkerer/contracts'
import type {
  BlockNode,
  ContentDocument,
  InlineNode,
  ListItemNode
} from '@tinytinkerer/content-core'

const withOptionalId = <T extends object>(node: { id?: string | undefined }, value: T): T & { id?: string } =>
  node.id ? { ...value, id: node.id } : value

const fromAssistantInlineNode = (node: AssistantInlineNode): InlineNode => {
  switch (node.type) {
    case 'text':
      return withOptionalId(node, { type: 'text', value: node.value })
    case 'emphasis':
      return withOptionalId(node, {
        type: 'emphasis',
        children: node.children.map(fromAssistantInlineNode)
      })
    case 'strong':
      return withOptionalId(node, {
        type: 'strong',
        children: node.children.map(fromAssistantInlineNode)
      })
    case 'strikethrough':
      return withOptionalId(node, {
        type: 'strikethrough',
        children: node.children.map(fromAssistantInlineNode)
      })
    case 'codeInline':
      return withOptionalId(node, { type: 'codeInline', value: node.value })
    case 'link':
      return withOptionalId(node, {
        type: 'link',
        url: node.url,
        ...(node.title ? { title: node.title } : {}),
        children: node.children.map(fromAssistantInlineNode)
      })
    case 'imageInline':
      return withOptionalId(node, {
        type: 'imageInline',
        url: node.url,
        alt: node.alt,
        ...(node.title ? { title: node.title } : {})
      })
    case 'break':
      return withOptionalId(node, { type: 'break' })
  }
}

const fromAssistantListItemNode = (node: AssistantListItemNode): ListItemNode =>
  withOptionalId(node, {
    type: 'listItem',
    ...(node.checked !== undefined ? { checked: node.checked } : {}),
    children: node.children.map(fromAssistantBlockNode)
  })

const fromAssistantBlockNode = (node: AssistantBlockNode): BlockNode => {
  switch (node.type) {
    case 'heading':
      return withOptionalId(node, {
        type: 'heading',
        level: node.level,
        children: node.children.map(fromAssistantInlineNode)
      })
    case 'paragraph':
      return withOptionalId(node, {
        type: 'paragraph',
        children: node.children.map(fromAssistantInlineNode)
      })
    case 'list':
      return withOptionalId(node, {
        type: 'list',
        ordered: node.ordered,
        ...(node.start !== undefined ? { start: node.start } : {}),
        children: node.children.map(fromAssistantListItemNode)
      })
    case 'blockquote':
      return withOptionalId(node, {
        type: 'blockquote',
        children: node.children.map(fromAssistantBlockNode)
      })
    case 'thematicBreak':
      return withOptionalId(node, { type: 'thematicBreak' })
    case 'codeBlock':
      return withOptionalId(node, {
        type: 'codeBlock',
        code: node.code,
        ...(node.language ? { language: node.language } : {})
      })
    case 'choicePrompt':
      return withOptionalId(node, {
        type: 'choicePrompt',
        prompt: node.prompt,
        choices: [...node.choices]
      })
    case 'table':
      return withOptionalId(node, {
        type: 'table',
        align: [...node.align],
        header: node.header.map((cell) => cell.map(fromAssistantInlineNode)),
        rows: node.rows.map((row) => row.map((cell) => cell.map(fromAssistantInlineNode)))
      })
    case 'image':
      return withOptionalId(node, {
        type: 'image',
        url: node.url,
        alt: node.alt,
        ...(node.title ? { title: node.title } : {})
      })
  }
}

const toAssistantInlineNode = (node: InlineNode): AssistantInlineNode => {
  switch (node.type) {
    case 'text':
      return withOptionalId(node, { type: 'text', value: node.value })
    case 'emphasis':
      return withOptionalId(node, {
        type: 'emphasis',
        children: node.children.map(toAssistantInlineNode)
      })
    case 'strong':
      return withOptionalId(node, {
        type: 'strong',
        children: node.children.map(toAssistantInlineNode)
      })
    case 'strikethrough':
      return withOptionalId(node, {
        type: 'strikethrough',
        children: node.children.map(toAssistantInlineNode)
      })
    case 'codeInline':
      return withOptionalId(node, { type: 'codeInline', value: node.value })
    case 'link':
      return withOptionalId(node, {
        type: 'link',
        url: node.url,
        ...(node.title ? { title: node.title } : {}),
        children: node.children.map(toAssistantInlineNode)
      })
    case 'imageInline':
      return withOptionalId(node, {
        type: 'imageInline',
        url: node.url,
        alt: node.alt,
        ...(node.title ? { title: node.title } : {})
      })
    case 'break':
      return withOptionalId(node, { type: 'break' })
  }
}

const toAssistantListItemNode = (node: ListItemNode): AssistantListItemNode =>
  withOptionalId(node, {
    type: 'listItem',
    ...(node.checked !== undefined ? { checked: node.checked } : {}),
    children: node.children.map(toAssistantBlockNode)
  })

const toAssistantBlockNode = (node: BlockNode): AssistantBlockNode => {
  switch (node.type) {
    case 'heading':
      return withOptionalId(node, {
        type: 'heading',
        level: node.level,
        children: node.children.map(toAssistantInlineNode)
      })
    case 'paragraph':
      return withOptionalId(node, {
        type: 'paragraph',
        children: node.children.map(toAssistantInlineNode)
      })
    case 'list':
      return withOptionalId(node, {
        type: 'list',
        ordered: node.ordered,
        ...(node.start !== undefined ? { start: node.start } : {}),
        children: node.children.map(toAssistantListItemNode)
      })
    case 'blockquote':
      return withOptionalId(node, {
        type: 'blockquote',
        children: node.children.map(toAssistantBlockNode)
      })
    case 'thematicBreak':
      return withOptionalId(node, { type: 'thematicBreak' })
    case 'codeBlock':
      return withOptionalId(node, {
        type: 'codeBlock',
        code: node.code,
        ...(node.language ? { language: node.language } : {})
      })
    case 'choicePrompt':
      return withOptionalId(node, {
        type: 'choicePrompt',
        prompt: node.prompt,
        choices: [...node.choices]
      })
    case 'table':
      return withOptionalId(node, {
        type: 'table',
        align: [...node.align],
        header: node.header.map((cell) => cell.map(toAssistantInlineNode)),
        rows: node.rows.map((row) => row.map((cell) => cell.map(toAssistantInlineNode)))
      })
    case 'image':
      return withOptionalId(node, {
        type: 'image',
        url: node.url,
        alt: node.alt,
        ...(node.title ? { title: node.title } : {})
      })
  }
}

export const assistantContentDocumentToContentDocument = (
  document: AssistantContentDocument
): ContentDocument => ({
  nodes: document.nodes.map(fromAssistantBlockNode)
})

export const contentDocumentToAssistantContentDocument = (
  document: ContentDocument
): AssistantContentDocument => ({
  nodes: document.nodes.map(toAssistantBlockNode)
})
