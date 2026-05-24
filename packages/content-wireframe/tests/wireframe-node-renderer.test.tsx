// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WireframeNodeRenderer } from '../src/index.js'

afterEach(() => {
  cleanup()
})

describe('WireframeNodeRenderer', () => {
  it('renders a styled wireframe panel', () => {
    const { container } = render(
      <WireframeNodeRenderer node={{ type: 'wireframe', code: '[Header]\n[Button]' }} />
    )

    expect(screen.getByText('Wireframe')).toBeInTheDocument()
    expect(container.querySelector('[data-tt-wireframe]')).not.toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('[Header]\n[Button]')
  })

  it('falls back to a code block for empty wireframes', () => {
    const { container } = render(<WireframeNodeRenderer node={{ type: 'wireframe', code: '   ' }} />)

    expect(container.querySelector('code')?.textContent).toBe('   ')
  })
})
