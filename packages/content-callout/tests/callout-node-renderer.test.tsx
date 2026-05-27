// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ContentDocumentContent,
  type BlockquoteNode,
  type ContentDocument
} from '@tinytinkerer/content-react'
import { calloutPlugin, createCalloutPlugin, matchesCallout } from '../src/index.js'

afterEach(() => {
  cleanup()
})

const blockquote = (firstText: string, extra: BlockquoteNode['children'] = []): BlockquoteNode => ({
  type: 'blockquote',
  children: [
    {
      type: 'paragraph',
      children: [{ type: 'text', value: firstText }]
    },
    ...extra
  ]
})

const documentWith = (node: BlockquoteNode): ContentDocument => ({ nodes: [node] })

describe('calloutPlugin', () => {
  it('exports the callout plugin for composition', () => {
    expect(calloutPlugin.nodeType).toBe('blockquote')
    expect(typeof calloutPlugin.render).toBe('function')
  })

  it('creates isolated plugin instances on demand', () => {
    const left = createCalloutPlugin()
    const right = createCalloutPlugin()

    expect(left).not.toBe(right)
    expect(left.id).toBe('callout')
    expect(right.id).toBe('callout')
  })

  it('matches blockquotes that begin with [!NOTE]-style markers', () => {
    expect(matchesCallout(blockquote('[!NOTE] hello'))).toBe(true)
    expect(matchesCallout(blockquote('[!warning] careful'))).toBe(true)
    expect(matchesCallout(blockquote('[!CAUTION]\nstop'))).toBe(true)
    expect(matchesCallout(blockquote('regular quote'))).toBe(false)
  })

  it('renders a note callout with label, icon, and body text', () => {
    render(
      <ContentDocumentContent
        document={documentWith(blockquote('[!NOTE] Pay attention to this section.'))}
        plugins={[calloutPlugin]}
      />
    )

    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByText(/Pay attention/)).toBeInTheDocument()
  })

  it('renders different visual variants for each callout kind', () => {
    for (const [marker, label] of [
      ['[!TIP] x', 'Tip'],
      ['[!WARNING] x', 'Warning'],
      ['[!IMPORTANT] x', 'Important'],
      ['[!CAUTION] x', 'Caution']
    ] as const) {
      const { container, unmount } = render(
        <ContentDocumentContent
          document={documentWith(blockquote(marker))}
          plugins={[calloutPlugin]}
        />
      )
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(container.querySelector('[data-tt-callout]')).not.toBeNull()
      unmount()
    }
  })

  it('falls through to the default blockquote renderer when there is no marker', () => {
    const { container } = render(
      <ContentDocumentContent
        document={documentWith(blockquote('Just a quote without a callout marker.'))}
        plugins={[calloutPlugin]}
      />
    )

    expect(container.querySelector('[data-tt-callout]')).toBeNull()
    expect(container.querySelector('blockquote')).not.toBeNull()
    expect(screen.getByText(/Just a quote/)).toBeInTheDocument()
  })

  it('strips only the marker and preserves trailing body text on the same line', () => {
    render(
      <ContentDocumentContent
        document={documentWith(blockquote('[!NOTE] keep this part'))}
        plugins={[calloutPlugin]}
      />
    )

    expect(screen.getByText('keep this part')).toBeInTheDocument()
  })

  it('renders body content from subsequent paragraphs', () => {
    render(
      <ContentDocumentContent
        document={documentWith(
          blockquote('[!WARNING]', [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: 'Second paragraph body.' }]
            }
          ])
        )}
        plugins={[calloutPlugin]}
      />
    )

    expect(screen.getByText('Second paragraph body.')).toBeInTheDocument()
  })
})
