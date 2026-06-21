// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ContentDocumentContent,
  type ContentDocument,
  type ParagraphNode
} from '@tinytinkerer/content-react'
import { createLinkCardPlugin, linkCardPlugin, matchesLinkCard } from '../src/index.js'

afterEach(() => {
  cleanup()
})

const paragraph = (children: ParagraphNode['children']): ParagraphNode => ({
  type: 'paragraph',
  children
})

const documentWith = (node: ParagraphNode): ContentDocument => ({ nodes: [node] })

const documentWithNodes = (nodes: ContentDocument['nodes']): ContentDocument => ({ nodes })

describe('linkCardPlugin', () => {
  it('exports the link-card plugin for composition', () => {
    expect(linkCardPlugin.nodeType).toBe('paragraph')
    expect(typeof linkCardPlugin.render).toBe('function')
    expect(linkCardPlugin.requirements).toBeUndefined()
  })

  it('creates isolated plugin instances on demand', () => {
    const left = createLinkCardPlugin()
    const right = createLinkCardPlugin()

    expect(left).not.toBe(right)
    expect(left.id).toBe('link-card')
    expect(right.id).toBe('link-card')
  })

  it('matches paragraphs whose only child is a LinkNode', () => {
    expect(
      matchesLinkCard(
        paragraph([
          {
            type: 'link',
            url: 'https://example.com/docs',
            children: [{ type: 'text', value: 'Read the docs' }]
          }
        ])
      )
    ).toBe(true)
  })

  it('matches paragraphs whose only child is a bare URL text node', () => {
    expect(matchesLinkCard(paragraph([{ type: 'text', value: '  https://example.com  ' }]))).toBe(
      true
    )
  })

  it('does not match paragraphs with multiple children', () => {
    expect(
      matchesLinkCard(
        paragraph([
          { type: 'text', value: 'See ' },
          {
            type: 'link',
            url: 'https://example.com',
            children: [{ type: 'text', value: 'docs' }]
          }
        ])
      )
    ).toBe(false)
  })

  it('does not match paragraphs whose single text node is not a URL', () => {
    expect(matchesLinkCard(paragraph([{ type: 'text', value: 'just plain text' }]))).toBe(false)
  })

  // Regression: `new URL()` parses any bare `word:` as a custom-scheme URL (e.g.
  // `new URL('Then:')` => protocol `then:`, empty host), so prose like a standalone
  // "Then:" used to be mistaken for a link card. A card requires a real http(s) URL.
  it.each(['Then:', 'note:', 'foo:', 'Note: something', '  Then:  '])(
    'does not match a non-web bare-text paragraph: %j',
    (value) => {
      expect(matchesLinkCard(paragraph([{ type: 'text', value }]))).toBe(false)
    }
  )

  it('does not match a bare mailto:/tel: text paragraph (no host, non-web scheme)', () => {
    expect(matchesLinkCard(paragraph([{ type: 'text', value: 'mailto:a@b.com' }]))).toBe(false)
    expect(matchesLinkCard(paragraph([{ type: 'text', value: 'tel:+15551234' }]))).toBe(false)
  })

  it('still matches a bare http URL text paragraph', () => {
    expect(matchesLinkCard(paragraph([{ type: 'text', value: 'http://example.com' }]))).toBe(true)
  })

  it('does not match an explicit link node with a non-web scheme', () => {
    expect(
      matchesLinkCard(
        paragraph([
          {
            type: 'link',
            url: 'mailto:a@b.com',
            children: [{ type: 'text', value: 'Email me' }]
          }
        ])
      )
    ).toBe(false)
    expect(
      matchesLinkCard(
        paragraph([
          {
            type: 'link',
            url: 'then:',
            children: [{ type: 'text', value: 'Then' }]
          }
        ])
      )
    ).toBe(false)
  })

  it('renders an anchor card with link title and hostname for LinkNode', () => {
    render(
      <ContentDocumentContent
        document={documentWith(
          paragraph([
            {
              type: 'link',
              url: 'https://example.com/docs/api',
              children: [{ type: 'text', value: 'API reference' }]
            }
          ])
        )}
        plugins={[linkCardPlugin]}
      />
    )

    const card = screen.getByRole('link', { name: /API reference/ })
    expect(card).toHaveAttribute('href', 'https://example.com/docs/api')
    expect(card).toHaveAttribute('target', '_blank')
    expect(card).toHaveAttribute('rel', 'noreferrer noopener')
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })

  it('falls back to hostname + path as the title for bare URLs', () => {
    render(
      <ContentDocumentContent
        document={documentWith(
          paragraph([{ type: 'text', value: 'https://example.com/docs/api' }])
        )}
        plugins={[linkCardPlugin]}
      />
    )

    expect(screen.getByText('example.com/docs/api')).toBeInTheDocument()
  })

  it('renders the exact repro sequence with no card and "Then:" as plain text', () => {
    // The reported repro: an inline-code line, a standalone "Then:", then another
    // inline-code line. Only the two code spans should render — "Then:" must be plain
    // text, and there must be no link card anywhere.
    const { container } = render(
      <ContentDocumentContent
        document={documentWithNodes([
          paragraph([{ type: 'codeInline', value: '56412 * 45644 = 2574869328' }]),
          paragraph([{ type: 'text', value: 'Then:' }]),
          paragraph([{ type: 'codeInline', value: '2574869328 * 123131 = 317046235225968' }])
        ])}
        plugins={[linkCardPlugin]}
      />
    )

    expect(container.querySelector('[data-tt-link-card]')).toBeNull()
    expect(screen.getByText('Then:')).toBeInTheDocument()
    expect(screen.getByText('56412 * 45644 = 2574869328')).toBeInTheDocument()
    expect(screen.getByText('2574869328 * 123131 = 317046235225968')).toBeInTheDocument()
  })

  it('falls through to the default paragraph renderer when no link is present', () => {
    const { container } = render(
      <ContentDocumentContent
        document={documentWith(paragraph([{ type: 'text', value: 'Just a normal sentence.' }]))}
        plugins={[linkCardPlugin]}
      />
    )

    expect(container.querySelector('[data-tt-link-card]')).toBeNull()
    expect(container.querySelector('p')).not.toBeNull()
    expect(screen.getByText('Just a normal sentence.')).toBeInTheDocument()
  })
})
