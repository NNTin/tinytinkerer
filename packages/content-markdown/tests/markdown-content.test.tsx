// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNodeRendererPlugin } from '@tinytinkerer/content-react'
import { MarkdownContent } from '../src/index.js'

afterEach(() => {
  cleanup()
})

describe('MarkdownContent', () => {
  it('renders parsed markdown through the shared React runtime', () => {
    render(<MarkdownContent content={'# Heading\n\n| Name | Role |\n| --- | --- |\n| Ada | Admin |'} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('renders user-supplied plugins alongside the default React runtime', () => {
    const mermaidStub: ReactNodeRendererPlugin<'mermaid'> = {
      id: 'mermaid-stub',
      nodeType: 'mermaid',
      render: (node) => <div>Diagram: {node.code}</div>
    }

    const { container } = render(
      <MarkdownContent
        content={['Intro', '', '```mermaid', 'graph TD', 'A-->B', '```'].join('\n')}
        className="prose-assistant"
        isStreaming
        plugins={[mermaidStub]}
      />
    )

    expect(container.firstChild).toHaveClass('tt-markdown')
    expect(container.firstChild).toHaveClass('tt-markdown--streaming')
    expect(container.firstChild).toHaveClass('prose-assistant')
    expect(screen.getByText(/Diagram: graph TD/)).toBeInTheDocument()
  })
})
