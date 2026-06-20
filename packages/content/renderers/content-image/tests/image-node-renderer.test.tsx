// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createImagePlugin, ImageNodeRenderer, imagePlugin } from '../src/index.js'

afterEach(() => {
  cleanup()
})

describe('ImageNodeRenderer', () => {
  it('exports the image plugin for composition', () => {
    expect(imagePlugin.nodeType).toBe('image')
    expect(typeof imagePlugin.render).toBe('function')
  })

  it('declares clientOnly but not needsDom so static rendering still works in non-DOM runtimes', () => {
    expect(imagePlugin.requirements).toEqual({ clientOnly: true })
  })

  it('creates isolated plugin instances on demand', () => {
    const left = createImagePlugin()
    const right = createImagePlugin()

    expect(left).not.toBe(right)
    expect(left.id).toBe('image')
    expect(right.id).toBe('image')
  })

  it('renders the image with lazy loading and the alt text', () => {
    render(
      <ImageNodeRenderer
        node={{ type: 'image', url: 'https://example.com/cat.png', alt: 'A cat' }}
      />
    )

    const img = screen.getByRole('img', { name: 'A cat' })
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('src', 'https://example.com/cat.png')
  })

  it('renders a figcaption when title is present', () => {
    render(
      <ImageNodeRenderer
        node={{
          type: 'image',
          url: 'https://example.com/cat.png',
          alt: 'A cat',
          title: 'Tabby cat'
        }}
      />
    )

    expect(screen.getByText('Tabby cat')).toBeInTheDocument()
  })

  it('falls back to alt text as caption when title is missing', () => {
    render(
      <ImageNodeRenderer
        node={{ type: 'image', url: 'https://example.com/cat.png', alt: 'Just a cat' }}
      />
    )

    expect(screen.getByText('Just a cat')).toBeInTheDocument()
  })

  it('omits the figcaption when there is no caption text', () => {
    const { container } = render(
      <ImageNodeRenderer node={{ type: 'image', url: 'https://example.com/cat.png', alt: '' }} />
    )

    expect(container.querySelector('figcaption')).toBeNull()
  })

  it('opens a lightbox when the image is clicked and closes on Close button', () => {
    render(
      <ImageNodeRenderer
        node={{ type: 'image', url: 'https://example.com/cat.png', alt: 'A cat' }}
      />
    )

    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /open/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /close image preview/i }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the lightbox on Escape key', () => {
    render(
      <ImageNodeRenderer
        node={{ type: 'image', url: 'https://example.com/cat.png', alt: 'A cat' }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /open/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('toggles zoom on the lightbox', () => {
    render(
      <ImageNodeRenderer
        node={{ type: 'image', url: 'https://example.com/cat.png', alt: 'A cat' }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /open/i }))

    const zoomButton = screen.getByRole('button', { name: 'Zoom' })
    fireEvent.click(zoomButton)

    expect(screen.getByRole('button', { name: 'Fit' })).toBeInTheDocument()
  })

  it('renders a raw SVG data URI as sanitized inline SVG (not an <img>)', () => {
    const { container } = render(
      <ImageNodeRenderer
        node={{
          type: 'image',
          url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
          alt: 'A red square'
        }}
      />
    )

    // Inline SVG is mounted...
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(container.querySelector('rect')).not.toBeNull()
    // ...and NOT delegated to an <img src>.
    expect(container.querySelector('img')).toBeNull()
  })

  it('neutralises a malicious raw SVG data URI (script + event handlers stripped)', () => {
    const { container } = render(
      <ImageNodeRenderer
        node={{
          type: 'image',
          url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="4" height="4" onclick="steal()"/></svg>',
          alt: 'xss'
        }}
      />
    )

    // The SVG still renders, but the dangerous bits are gone.
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('script')).toBeNull()
    const html = container.innerHTML.toLowerCase()
    expect(html).not.toContain('onload')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('alert(2)')
    expect(html).not.toContain('steal()')
  })

  it('still uses an <img> for base64 and percent-encoded SVG data URIs', () => {
    const { container, rerender } = render(
      <ImageNodeRenderer
        node={{
          type: 'image',
          url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
          alt: 'b64'
        }}
      />
    )
    expect(container.querySelector('img')).not.toBeNull()

    rerender(
      <ImageNodeRenderer
        node={{ type: 'image', url: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E', alt: 'pct' }}
      />
    )
    expect(container.querySelector('img')).not.toBeNull()
  })

  it('exposes Open and Download links pointing at the source URL', () => {
    render(
      <ImageNodeRenderer
        node={{ type: 'image', url: 'https://example.com/cat.png', alt: 'A cat' }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /open/i }))

    const openLink = screen.getByRole('link', { name: 'Open' })
    expect(openLink).toHaveAttribute('href', 'https://example.com/cat.png')
    expect(openLink).toHaveAttribute('target', '_blank')

    const downloadLink = screen.getByRole('link', { name: 'Download' })
    expect(downloadLink).toHaveAttribute('href', 'https://example.com/cat.png')
    expect(downloadLink).toHaveAttribute('download', 'cat.png')
  })
})
