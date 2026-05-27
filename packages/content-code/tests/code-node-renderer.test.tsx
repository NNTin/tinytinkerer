// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CodeNodeRenderer,
  codePlugin,
  createCodePlugin,
  resetHighlighterState
} from '../src/index.js'

afterEach(() => {
  cleanup()
  resetHighlighterState()
  document.getElementById('tt-content-code-highlighter-styles')?.remove()
})

describe('codePlugin', () => {
  it('exports the code plugin for composition', () => {
    expect(codePlugin.nodeType).toBe('codeBlock')
    expect(typeof codePlugin.render).toBe('function')
  })

  it('creates isolated plugin instances on demand', () => {
    const left = createCodePlugin()
    const right = createCodePlugin()

    expect(left).not.toBe(right)
    expect(left.id).toBe('code')
    expect(right.id).toBe('code')
  })

  it('only matches codeBlocks that declare a language', () => {
    expect(codePlugin.matches?.({ type: 'codeBlock', code: 'plain', language: 'json' })).toBe(true)
    expect(codePlugin.matches?.({ type: 'codeBlock', code: 'plain' })).toBe(false)
  })

  it('declares lazy and clientOnly requirements but not needsDom', () => {
    expect(codePlugin.requirements).toEqual({ lazy: true, clientOnly: true })
  })
})

describe('CodeNodeRenderer dispatch', () => {
  it('renders a diff block with +/- styling', () => {
    const code = ['--- a/file', '+++ b/file', '@@ -1,3 +1,3 @@', ' keep', '-old line', '+new line'].join('\n')
    const { container } = render(
      <CodeNodeRenderer node={{ type: 'codeBlock', code, language: 'diff' }} />
    )

    expect(screen.getByText('DIFF')).toBeInTheDocument()
    expect(container.querySelector('.bg-green-50')?.textContent).toContain('+new line')
    expect(container.querySelector('.bg-red-50')?.textContent).toContain('-old line')
    expect(container.querySelector('.bg-blue-50')?.textContent).toContain('@@')
  })

  it('renders the chrome label uppercase for any language', () => {
    render(<CodeNodeRenderer node={{ type: 'codeBlock', code: '{}', language: 'json' }} />)
    expect(screen.getByText('JSON')).toBeInTheDocument()
  })

  it('shows a Format toggle for valid JSON and switches the rendered text', () => {
    const compact = '{"a":1,"b":[1,2]}'
    render(<CodeNodeRenderer node={{ type: 'codeBlock', code: compact, language: 'json' }} />)

    const formatButton = screen.getByRole('button', { name: 'Format' })
    expect(formatButton).toBeInTheDocument()

    fireEvent.click(formatButton)
    expect(screen.getByRole('button', { name: 'Compact' })).toBeInTheDocument()
  })

  it('omits the Format toggle when JSON is invalid', () => {
    render(
      <CodeNodeRenderer node={{ type: 'codeBlock', code: '{not json', language: 'json' }} />
    )
    expect(screen.queryByRole('button', { name: 'Format' })).toBeNull()
  })

  it('renders highlighted code element for yaml/sql/bash/http languages', () => {
    for (const language of ['yaml', 'sql', 'bash', 'http']) {
      const { container, unmount } = render(
        <CodeNodeRenderer node={{ type: 'codeBlock', code: 'x: 1', language }} />
      )
      expect(container.querySelector('[data-tt-code]')).not.toBeNull()
      unmount()
    }
  })

  it('renders a generic highlighted block for unknown languages', () => {
    const { container } = render(
      <CodeNodeRenderer node={{ type: 'codeBlock', code: 'fn main() {}', language: 'rust' }} />
    )
    expect(container.querySelector('[data-tt-code]')).not.toBeNull()
    expect(container.querySelector('code')?.textContent).toContain('fn main()')
  })

  it('switches to the raw code view via the Code button in the chrome', () => {
    const { container } = render(
      <CodeNodeRenderer node={{ type: 'codeBlock', code: 'SELECT 1', language: 'sql' }} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Code' }))

    expect(container.querySelector('code')?.textContent).toBe('SELECT 1')
  })
})
