import { describe, expect, it } from 'vitest'
import type { BlockNode, ContentDocument, InlineNode } from '@tinytinkerer/content-core'
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
      const next: InlineNode = {
        type: 'link',
        url: node.url,
        children: node.children.map(stripInline)
      }
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
        parseMarkdownContent(
          ['Intro', '', '```mermaid', 'graph TD', 'A-->B', '```', '', 'After'].join('\n')
        )
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
    expect(
      stripIds(parseMarkdownContent(['```ts', 'const answer = 42', '```'].join('\n')))
    ).toEqual({
      nodes: [{ type: 'codeBlock', code: 'const answer = 42', language: 'ts' }]
    })
  })

  it('promotes tables into table nodes', () => {
    expect(
      stripIds(
        parseMarkdownContent(['| Name | Role |', '| --- | --- |', '| Ada | Admin |'].join('\n'))
      )
    ).toEqual({
      nodes: [
        {
          type: 'table',
          align: [null, null],
          header: [[{ type: 'text', value: 'Name' }], [{ type: 'text', value: 'Role' }]],
          rows: [[[{ type: 'text', value: 'Ada' }], [{ type: 'text', value: 'Admin' }]]]
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

    expect(
      stripIds(parseMarkdownContent('Inline ![icon](https://example.com/icon.png) image'))
    ).toEqual({
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
              children: [{ type: 'paragraph', children: [{ type: 'text', value: 'one' }] }]
            },
            {
              type: 'listItem',
              children: [{ type: 'paragraph', children: [{ type: 'text', value: 'two' }] }]
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

  it('drops relative and protocol-relative image URLs to empty src', () => {
    expect(stripIds(parseMarkdownContent('![rel](/path/a.png)'))).toEqual({
      nodes: [{ type: 'image', url: '', alt: 'rel' }]
    })
    expect(stripIds(parseMarkdownContent('![protorel](//host/a.png)'))).toEqual({
      nodes: [{ type: 'image', url: '', alt: 'protorel' }]
    })
  })

  it('preserves a raw SVG data URI as a standalone image node (survives parsing)', () => {
    const raw =
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    expect(stripIds(parseMarkdownContent(`![chart](${raw})`))).toEqual({
      nodes: [{ type: 'image', url: raw, alt: 'chart' }]
    })
  })

  it('preserves a raw SVG data URI with a title', () => {
    const raw = 'data:image/svg+xml,<svg width="10" height="10"></svg>'
    expect(stripIds(parseMarkdownContent(`![chart](${raw} "My Chart")`))).toEqual({
      nodes: [{ type: 'image', url: raw, alt: 'chart', title: 'My Chart' }]
    })
  })

  it('preserves a partially percent-encoded SVG data URI as a standalone image node', () => {
    const partial =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='80' viewBox='0 0 160 80'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1'%3E%3Cstop stop-color='%23ff7a59'/%3E%3Cstop offset='1' stop-color='%2300a6fb'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='160' height='80' rx='16' fill='url(%23g)'/%3E%3Ccircle cx='40' cy='40' r='18' fill='white' fill-opacity='.85'/%3E%3C/svg%3E"
    const normalized =
      "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='80' viewBox='0 0 160 80'><defs><linearGradient id='g' x1='0' x2='1'><stop stop-color='#ff7a59'/><stop offset='1' stop-color='#00a6fb'/></linearGradient></defs><rect width='160' height='80' rx='16' fill='url(#g)'/><circle cx='40' cy='40' r='18' fill='white' fill-opacity='.85'/></svg>"
    expect(stripIds(parseMarkdownContent(`![Gradient dot](${partial})`))).toEqual({
      nodes: [{ type: 'image', url: normalized, alt: 'Gradient dot' }]
    })
  })

  it('preserves an inline raw SVG data URI as an imageInline node', () => {
    const raw = 'data:image/svg+xml,<svg width="4"></svg>'
    expect(stripIds(parseMarkdownContent(`Look ![icon](${raw}) here`))).toEqual({
      nodes: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Look ' },
            { type: 'imageInline', url: raw, alt: 'icon' },
            { type: 'text', value: ' here' }
          ]
        }
      ]
    })
  })

  it('preserves a partially percent-encoded SVG data URI as an inline image node', () => {
    const partial =
      "data:image/svg+xml,%3Csvg width='4' height='4'%3E%3Ccircle cx='2' cy='2' r='2' fill='url(%23g)'/%3E%3C/svg%3E"
    const normalized =
      "data:image/svg+xml,<svg width='4' height='4'><circle cx='2' cy='2' r='2' fill='url(#g)'/></svg>"
    expect(stripIds(parseMarkdownContent(`Look ![icon](${partial}) here`))).toEqual({
      nodes: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Look ' },
            { type: 'imageInline', url: normalized, alt: 'icon' },
            { type: 'text', value: ' here' }
          ]
        }
      ]
    })
  })

  it('keeps the raw markup (including a malicious payload) on the node for the renderer to sanitize', () => {
    // Parsing only routes the raw SVG to the inline renderer; neutralising the
    // payload (script/onload) is the renderer's DOMPurify pass, asserted there.
    const raw = 'data:image/svg+xml,<svg onload="alert(1)"><script>alert(2)</script></svg>'
    const [node] = parseMarkdownContent(`![x](${raw})`).nodes
    expect(node?.type).toBe('image')
    expect(node?.type === 'image' && node.url).toBe(raw)
  })

  it('handles a raw SVG title that itself contains a closing parenthesis', () => {
    const raw = 'data:image/svg+xml,<svg></svg>'
    expect(stripIds(parseMarkdownContent(`![c](${raw} "a) b")`))).toEqual({
      nodes: [{ type: 'image', url: raw, alt: 'c', title: 'a) b' }]
    })
  })

  it('extracts multiple raw SVG images in one document independently', () => {
    const a = 'data:image/svg+xml,<svg id="1"></svg>'
    const b = 'data:image/svg+xml,<svg id="2"></svg>'
    expect(stripIds(parseMarkdownContent(`![a](${a}) and ![b](${b})`))).toEqual({
      nodes: [
        {
          type: 'paragraph',
          children: [
            { type: 'imageInline', url: a, alt: 'a' },
            { type: 'text', value: ' and ' },
            { type: 'imageInline', url: b, alt: 'b' }
          ]
        }
      ]
    })
  })

  it('does not produce a raw SVG image node when the </svg> close is missing', () => {
    // An unterminated raw SVG (e.g. mid-stream) must not be treated as an image — it
    // degrades to text exactly as before, rather than being misparsed.
    const doc = parseMarkdownContent('![c](data:image/svg+xml,<svg width="10">) trailing')
    expect(doc.nodes.every((n) => n.type !== 'image')).toBe(true)
  })

  it('leaves base64 and percent-encoded SVG data URIs untouched', () => {
    expect(
      stripIds(parseMarkdownContent('![b64](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)'))
    ).toEqual({
      nodes: [{ type: 'image', url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', alt: 'b64' }]
    })
    expect(
      stripIds(parseMarkdownContent('![pct](data:image/svg+xml,%3Csvg%3E%3C/svg%3E)'))
    ).toEqual({
      nodes: [{ type: 'image', url: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E', alt: 'pct' }]
    })
  })

  it('sanitizes unsafe link schemes', () => {
    expect(stripIds(parseMarkdownContent('[xss](javascript:alert(1))'))).toEqual({
      nodes: [
        {
          type: 'paragraph',
          children: [{ type: 'link', url: '', children: [{ type: 'text', value: 'xss' }] }]
        }
      ]
    })
  })

  it('preserves unsupported block nodes as safe paragraph text', () => {
    expect(stripIds(parseMarkdownContent('<div>example</div>'))).toEqual({
      nodes: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '<div>example</div>' }]
        }
      ]
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
