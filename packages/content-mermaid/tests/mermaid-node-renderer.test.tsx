// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockInitialize = vi.hoisted(() => vi.fn())
const mockRender = vi.hoisted(() => vi.fn())

import { MermaidNodeRenderer } from '../src/index.js'

afterEach(() => {
  cleanup()
  delete window.mermaid
})

beforeEach(() => {
  mockInitialize.mockReset()
  mockRender.mockReset()
  window.mermaid = {
    initialize: mockInitialize,
    render: mockRender
  }
})

describe('MermaidNodeRenderer', () => {
  it('renders svg output after the mermaid runtime loads', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' })

    const { container } = render(<MermaidNodeRenderer node={{ type: 'mermaid', code: 'graph TD\nA-->B' }} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Mermaid diagram')).toBeInTheDocument()
    })

    expect(mockInitialize).toHaveBeenCalledTimes(1)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('falls back to a code block when mermaid rendering fails', async () => {
    mockRender.mockRejectedValue(new Error('render failed'))

    const { container } = render(<MermaidNodeRenderer node={{ type: 'mermaid', code: 'graph TD\nA-->B' }} />)

    await waitFor(() => {
      expect(container.querySelector('code')?.textContent).toBe('graph TD\nA-->B')
    })
  })
})
