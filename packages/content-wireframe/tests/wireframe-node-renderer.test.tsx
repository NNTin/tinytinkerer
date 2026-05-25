// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WireframeNodeRenderer } from '../src/index.js'

const HELLO_WORLD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Hello World Wireframe</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      display: flex;
      height: 100vh;
      justify-content: center;
      align-items: center;
      margin: 0;
      background: #f0f0f0;
      border: 2px dashed #ccc;
    }
  </style>
</head>
<body>
  <h1>Hello World</h1>
</body>
</html>`

afterEach(() => {
  cleanup()
})

describe('WireframeNodeRenderer', () => {
  it('renders the wireframe chrome with the label', () => {
    render(<WireframeNodeRenderer node={{ type: 'wireframe', code: HELLO_WORLD_HTML }} />)

    expect(screen.getByText('Wireframe')).toBeInTheDocument()
  })

  it('renders the wrapper element', () => {
    const { container } = render(
      <WireframeNodeRenderer node={{ type: 'wireframe', code: HELLO_WORLD_HTML }} />
    )

    expect(container.querySelector('[data-tt-wireframe]')).not.toBeNull()
  })

  it('renders HTML content in a sandboxed iframe', () => {
    const { container } = render(
      <WireframeNodeRenderer node={{ type: 'wireframe', code: HELLO_WORLD_HTML }} />
    )

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('srcdoc')).toBe(HELLO_WORLD_HTML)
    expect(iframe?.getAttribute('sandbox')).not.toBeNull()
  })

  it('does not leak wireframe HTML into the parent document', () => {
    const { container } = render(
      <WireframeNodeRenderer node={{ type: 'wireframe', code: HELLO_WORLD_HTML }} />
    )

    // The h1 from the wireframe HTML must not appear as a real DOM node in the parent
    expect(container.querySelector('h1')).toBeNull()
  })

  it('falls back to a code block for empty wireframes', () => {
    const { container } = render(
      <WireframeNodeRenderer node={{ type: 'wireframe', code: '   ' }} />
    )

    expect(container.querySelector('code')?.textContent).toBe('   ')
    expect(container.querySelector('iframe')).toBeNull()
  })
})
