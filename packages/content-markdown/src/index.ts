import { toString } from 'mdast-util-to-string'
import type { Content, Root, Table, TableCell } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { createElement, useMemo } from 'react'
import {
  type ContentDocument,
  type ContentNode,
  type ContentParser,
  type ImageNode,
  type TableAlignment,
  type TableNode
} from '@tinytinkerer/content-core'
import {
  ContentDocumentRenderer,
  type ReactContentRendererRegistry
} from '@tinytinkerer/content-react'
import { unified } from 'unified'

const parser = unified().use(remarkParse).use(remarkGfm)
const stringifier = unified().use(remarkStringify).use(remarkGfm)

const flushMarkdown = (children: Content[], nodes: ContentNode[]) => {
  if (children.length === 0) {
    return
  }

  const markdownRoot: Root = { type: 'root', children }
  const markdown = stringifier.stringify(markdownRoot).trim()

  if (markdown) {
    nodes.push({ type: 'markdown', markdown })
  }

  children.length = 0
}

const sanitizeImageUrl = (url: string): string => {
  if (/^https?:/i.test(url)) return url
  if (/^data:image\//i.test(url)) return url
  return ''
}

const asStandaloneImage = (node: Content): ImageNode | null => {
  if (node.type !== 'paragraph') {
    return null
  }

  if (node.children.length !== 1) {
    return null
  }

  const onlyChild = node.children[0]
  if (!onlyChild || onlyChild.type !== 'image') {
    return null
  }

  return {
    type: 'image',
    url: sanitizeImageUrl(onlyChild.url),
    alt: onlyChild.alt ?? '',
    ...(onlyChild.title ? { title: onlyChild.title } : {})
  }
}

const tableCellToText = (cell: TableCell): string => toString(cell).trim()

const asTableNode = (node: Content): TableNode | null => {
  if (node.type !== 'table') {
    return null
  }

  const header = node.children[0]
  const body = node.children.slice(1)
  const align = node.align ?? []

  return {
    type: 'table',
    align: align.map((value): TableAlignment => value ?? null),
    header: header ? header.children.map(tableCellToText) : [],
    rows: body.map((row: Table['children'][number]) => row.children.map(tableCellToText))
  }
}

const asSpecialCodeBlock = (node: Content): ContentNode | null => {
  if (node.type !== 'code') {
    return null
  }

  const base = {
    code: node.value,
    ...(node.meta ? { meta: node.meta } : {})
  }

  if (node.lang === 'mermaid') {
    return { type: 'mermaid', ...base }
  }

  if (node.lang === 'wireframe') {
    return { type: 'wireframe', ...base }
  }

  return {
    type: 'codeBlock',
    ...base,
    ...(node.lang ? { language: node.lang } : {})
  }
}

export const parseMarkdownContent: ContentParser = (content) => {
  const root = parser.parse(content)
  const nodes: ContentNode[] = []
  const markdownChildren: Content[] = []

  for (const child of root.children) {
    const specialCode = asSpecialCodeBlock(child)
    if (specialCode) {
      flushMarkdown(markdownChildren, nodes)
      nodes.push(specialCode)
      continue
    }

    const table = asTableNode(child)
    if (table) {
      flushMarkdown(markdownChildren, nodes)
      nodes.push(table)
      continue
    }

    const image = asStandaloneImage(child)
    if (image) {
      flushMarkdown(markdownChildren, nodes)
      nodes.push(image)
      continue
    }

    markdownChildren.push(child)
  }

  flushMarkdown(markdownChildren, nodes)

  return { nodes } satisfies ContentDocument
}

export type MarkdownContentProps = {
  content: string
  className?: string
  isStreaming?: boolean
  renderers?: ReactContentRendererRegistry
}

export const MarkdownContent = ({
  content,
  className,
  isStreaming = false,
  renderers
}: MarkdownContentProps) => {
  const document = useMemo(() => parseMarkdownContent(content), [content])

  return createElement(ContentDocumentRenderer, {
    document,
    isStreaming,
    ...(className ? { className } : {}),
    ...(renderers ? { renderers } : {})
  })
}
