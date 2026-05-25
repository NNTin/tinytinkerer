import { describe, expect, it } from 'vitest'
import { parseMarkdownContent } from '../src/index.js'

describe('parseMarkdownContent', () => {
  it('keeps plain prose as markdown', () => {
    expect(parseMarkdownContent('Hello world')).toEqual({
      nodes: [{ type: 'markdown', markdown: 'Hello world' }]
    })
  })

  it('promotes fenced mermaid and wireframe blocks while preserving order', () => {
    expect(
      parseMarkdownContent(['Intro', '', '```mermaid', 'graph TD', 'A-->B', '```', '', 'After'].join('\n'))
    ).toEqual({
      nodes: [
        { type: 'markdown', markdown: 'Intro' },
        { type: 'mermaid', code: 'graph TD\nA-->B' },
        { type: 'markdown', markdown: 'After' }
      ]
    })

    expect(parseMarkdownContent(['```wireframe', '[Button]', '```'].join('\n'))).toEqual({
      nodes: [{ type: 'wireframe', code: '[Button]' }]
    })
  })

  it('promotes normal fenced code to codeBlock nodes', () => {
    expect(parseMarkdownContent(['```ts', 'const answer = 42', '```'].join('\n'))).toEqual({
      nodes: [{ type: 'codeBlock', code: 'const answer = 42', language: 'ts' }]
    })
  })

  it('promotes tables into table nodes', () => {
    expect(parseMarkdownContent(['| Name | Role |', '| --- | --- |', '| Ada | Admin |'].join('\n'))).toEqual({
      nodes: [
        {
          type: 'table',
          align: [null, null],
          header: ['Name', 'Role'],
          rows: [['Ada', 'Admin']]
        }
      ]
    })
  })

  it('promotes standalone block images but keeps inline images in markdown', () => {
    expect(parseMarkdownContent('![Diagram](https://example.com/diagram.png)')).toEqual({
      nodes: [
        {
          type: 'image',
          url: 'https://example.com/diagram.png',
          alt: 'Diagram'
        }
      ]
    })

    expect(parseMarkdownContent('Inline ![icon](https://example.com/icon.png) image')).toEqual({
      nodes: [{ type: 'markdown', markdown: 'Inline ![icon](https://example.com/icon.png) image' }]
    })
  })

  it('keeps markdown structure such as lists and headings intact inside markdown nodes', () => {
    expect(parseMarkdownContent(['# Heading', '', '- one', '- two'].join('\n'))).toEqual({
      nodes: [{ type: 'markdown', markdown: '# Heading\n\n* one\n* two' }]
    })
  })

  it('preserves node sequence for a mixed document (markdown, mermaid, wireframe, table, image interleaved)', () => {
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
      'markdown',
      'mermaid',
      'markdown',
      'wireframe',
      'table',
      'image',
      'markdown'
    ])
  })

  it('sanitizes javascript: URLs in standalone image nodes to empty src', () => {
    expect(parseMarkdownContent('![xss](javascript:alert(1))')).toEqual({
      nodes: [{ type: 'image', url: '', alt: 'xss' }]
    })
  })
})
