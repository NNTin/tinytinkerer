// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownContent } from '../src/index.js'

afterEach(() => {
  cleanup()
})

describe('MarkdownContent', () => {
  it('renders plain text', () => {
    render(<MarkdownContent content="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders headings', () => {
    render(<MarkdownContent content="# Heading 1" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Heading 1' })).toBeInTheDocument()
  })

  it('renders h2 heading', () => {
    render(<MarkdownContent content="## Heading 2" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Heading 2' })).toBeInTheDocument()
  })

  it('renders unordered list', () => {
    render(<MarkdownContent content={'- item one\n- item two'} />)
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByText('item one')).toBeInTheDocument()
    expect(screen.getByText('item two')).toBeInTheDocument()
  })

  it('renders ordered list', () => {
    const { container } = render(<MarkdownContent content={'1. first\n2. second'} />)
    const list = container.querySelector('ol')
    expect(list).not.toBeNull()
    if (!list) {
      throw new Error('Expected an ordered list')
    }
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(screen.getByText('first')).toBeInTheDocument()
  })

  it('renders a link', () => {
    render(<MarkdownContent content="[click here](https://example.com)" />)
    const link = screen.getByRole('link', { name: 'click here' })
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it('renders inline code', () => {
    render(<MarkdownContent content="use `const x = 1`" />)
    expect(screen.getByText('const x = 1').tagName.toLowerCase()).toBe('code')
  })

  it('renders fenced code block', () => {
    render(<MarkdownContent content={'```\nconst a = 2\n```'} />)
    expect(screen.getByText('const a = 2')).toBeInTheDocument()
    const pre = screen.getByText('const a = 2').closest('pre')
    expect(pre).toBeInTheDocument()
  })

  it('renders bold emphasis', () => {
    render(<MarkdownContent content="**bold text**" />)
    expect(screen.getByText('bold text').tagName.toLowerCase()).toBe('strong')
  })

  it('renders italic emphasis', () => {
    render(<MarkdownContent content="_italic text_" />)
    expect(screen.getByText('italic text').tagName.toLowerCase()).toBe('em')
  })

  it('adds streaming-cursor class when isStreaming is true', () => {
    const { container } = render(<MarkdownContent content="streaming..." isStreaming />)
    expect(container.firstChild).toHaveClass('streaming-cursor')
  })

  it('accepts a custom className', () => {
    const { container } = render(<MarkdownContent content="done" className="prose-assistant" />)
    expect(container.firstChild).toHaveClass('prose-assistant')
  })
})
