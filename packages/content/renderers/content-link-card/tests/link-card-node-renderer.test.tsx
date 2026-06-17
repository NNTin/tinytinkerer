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
