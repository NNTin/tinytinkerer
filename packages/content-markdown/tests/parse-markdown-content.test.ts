import { describe, expect, it } from 'vitest'
import type { BlockNode, ContentDocument, InlineNode } from '@tinytinkerer/content-react'
import { parseMarkdownContent } from '../src/index.js'

const stripIds = (doc: ContentDocument): ContentDocument => ({
  nodes: doc.nodes.map(stripBlock)
})

const stripBlock = (node: BlockNode): BlockNode => {
  switch (node.type) {
    case 'heading':
      return { type: 'heading', level: node.level, children: node.children.map(stripInline) }
    case 'paragraph':
      return { type: 'paragraph', children: node.children.map(stripInline) }
    case 'list': {
      const next: BlockNode = {
        type: 'list',
        ordered: node.ordered,
        children: node.children.map((item) => ({
          type: 'listItem',
          ...(typeof item.checked === 'boolean' ? { checked: item.checked } : {}),
          children: item.children.map(stripBlock)
        }))
      }
      if (typeof node.start === 'number') next.start = node.start
      return next
    }
    case 'blockquote':
      return { type: 'blockquote', children: node.children.map(stripBlock) }
    case 'thematicBreak':
      return { type: 'thematicBreak' }
    case 'image': {
      const next: BlockNode = { type: 'image', url: node.url, alt: node.alt }
      if (node.title) next.title = node.title
      return next
    }
    case 'table':
      return {
        type: 'table',
        align: node.align,
        header: node.header.map((cell) => cell.map(stripInline)),
        rows: node.rows.map((row) => row.map((cell) => cell.map(stripInline)))
      }
    case 'codeBlock': {
      const next: BlockNode = { type: 'codeBlock', code: node.code }
      if (node.language) next.language = node.language
      return next
    }
    case 'choicePrompt':
      return { type: 'choicePrompt', prompt: node.prompt, choices: node.choices }
  }
}

const stripInline = (node: InlineNode): InlineNode => {
  switch (node.type) {
    case 'text':
      return { type: 'text', value: node.value }
    case 'emphasis':
    case 'strong':
    case 'strikethrough':
      return { type: node.type, children: node.children.map(stripInline) }
    case 'codeInline':
      return { type: 'codeInline', value: node.value }
    case 'link': {
      const next: InlineNode = { type: 'link', url: node.url, children: node.children.map(stripInline) }
      if (node.title) next.title = node.title
      return next
    }
    case 'imageInline': {
      const next: InlineNode = { type: 'imageInline', url: node.url, alt: node.alt }
      if (node.title) next.title = node.title
      return next
    }
    case 'break':
      return { type: 'break' }
    default:
      return node
  }
}

describe('parseMarkdownContent', () => {
  it('emits a paragraph node for plain prose', () => {
    expect(stripIds(parseMarkdownContent('Hello world'))).toEqual({
      nodes: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Hello world' }]
        }
      ]
    })
  })

  it('promotes fenced mermaid and wireframe blocks while preserving order', () => {
    expect(
      stripIds(
        parseMarkdownContent(['Intro', '', '```mermaid', 'graph TD', 'A-->B', '```', '', 'After'].join('\n'))
      )
    ).toEqual({
      nodes: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Intro' }] },
        { type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' },
        { type: 'paragraph', children: [{ type: 'text', value: 'After' }] }
      ]
    })

    expect(stripIds(parseMarkdownContent(['```wireframe', '[Button]', '```'].join('\n')))).toEqual({
      nodes: [{ type: 'codeBlock', code: '[Button]', language: 'wireframe' }]
    })
  })

  it('promotes normal fenced code to codeBlock nodes', () => {
    expect(stripIds(parseMarkdownContent(['```ts', 'const answer = 42', '```'].join('\n')))).toEqual({
      nodes: [{ type: 'codeBlock', code: 'const answer = 42', language: 'ts' }]
    })
  })

  it('promotes tables into table nodes', () => {
    expect(
      stripIds(parseMarkdownContent(['| Name | Role |', '| --- | --- |', '| Ada | Admin |'].join('\n')))
    ).toEqual({
      nodes: [
        {
          type: 'table',
          align: [null, null],
          header: [
            [{ type: 'text', value: 'Name' }],
            [{ type: 'text', value: 'Role' }]
          ],
          rows: [
            [
              [{ type: 'text', value: 'Ada' }],
              [{ type: 'text', value: 'Admin' }]
            ]
          ]
        }
      ]
    })
  })

  it('promotes standalone block images but keeps inline images attached to surrounding prose', () => {
    expect(stripIds(parseMarkdownContent('![Diagram](https://example.com/diagram.png)'))).toEqual({
      nodes: [
        {
          type: 'image',
          url: 'https://example.com/diagram.png',
          alt: 'Diagram'
        }
      ]
    })

    expect(stripIds(parseMarkdownContent('Inline ![icon](https://example.com/icon.png) image'))).toEqual({
      nodes: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Inline ' },
            { type: 'imageInline', url: 'https://example.com/icon.png', alt: 'icon' },
            { type: 'text', value: ' image' }
          ]
        }
      ]
    })
  })

  it('decomposes headings and lists into semantic nodes', () => {
    expect(stripIds(parseMarkdownContent(['# Heading', '', '- one', '- two'].join('\n')))).toEqual({
      nodes: [
        {
          type: 'heading',
          level: 1,
          children: [{ type: 'text', value: 'Heading' }]
        },
        {
          type: 'list',
          ordered: false,
          children: [
            {
              type: 'listItem',
              children: [
                { type: 'paragraph', children: [{ type: 'text', value: 'one' }] }
              ]
            },
            {
              type: 'listItem',
              children: [
                { type: 'paragraph', children: [{ type: 'text', value: 'two' }] }
              ]
            }
          ]
        }
      ]
    })
  })

  it('preserves node sequence for a mixed document', () => {
    const content = [
      '# Title',
      '',
      '```mermaid',
      'graph TD',
      'A-->B',
      '```',
      '',
      'Some text',
      '',
      '```wireframe',
      '[Button]',
      '```',
      '',
      '| Col |',
      '| --- |',
      '| val |',
      '',
      '![img](https://example.com/img.png)',
      '',
      'End'
    ].join('\n')

    const doc = parseMarkdownContent(content)
    expect(doc.nodes.map((n) => n.type)).toEqual([
      'heading',
      'codeBlock',
      'paragraph',
      'codeBlock',
      'table',
      'image',
      'paragraph'
    ])
  })

  it('sanitizes javascript: URLs in standalone image nodes to empty src', () => {
    expect(stripIds(parseMarkdownContent('![xss](javascript:alert(1))'))).toEqual({
      nodes: [{ type: 'image', url: '', alt: 'xss' }]
    })
  })

  it('assigns deterministic ids that are stable across reparses', () => {
    const a = parseMarkdownContent('Hello world\n\n## Subhead')
    const b = parseMarkdownContent('Hello world\n\n## Subhead')
    expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id))
    expect(a.nodes[0]?.id).toBeTruthy()
  })

  it('keeps prefix ids stable when content is appended', () => {
    const initial = parseMarkdownContent('Intro\n\n## Heading')
    const extended = parseMarkdownContent('Intro\n\n## Heading\n\nNew tail')
    expect(extended.nodes[0]?.id).toBe(initial.nodes[0]?.id)
    expect(extended.nodes[1]?.id).toBe(initial.nodes[1]?.id)
    expect(extended.nodes.length).toBe(initial.nodes.length + 1)
  })

  it('disambiguates identical-content nodes by occurrence', () => {
    const doc = parseMarkdownContent('Hello\n\nHello')
    const first = doc.nodes[0]
    const second = doc.nodes[1]
    expect(first?.type).toBe('paragraph')
    expect(second?.type).toBe('paragraph')
    expect(first?.id).not.toBe(second?.id)
  })
})
