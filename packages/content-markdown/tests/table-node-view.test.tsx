// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TableNode } from '@tinytinkerer/content-core'
import { TableNodeView, tableToMarkdown } from '../src/index.js'

afterEach(() => {
  cleanup()
})

describe('TableNodeView', () => {
  const node: TableNode = {
    type: 'table',
    align: ['left', 'right', 'center'],
    header: ['Name', 'Role', 'Score'],
    rows: [['Ada', 'Admin', '3']]
  }

  it('renders semantic table markup from a TableNode', () => {
    const { container } = render(<TableNodeView node={node} />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('align', 'left')
    expect(screen.getByRole('columnheader', { name: 'Role' })).toHaveAttribute('align', 'right')
    expect(container.querySelector('td[align="center"]')?.textContent).toBe('3')
  })

  it('serializes aligned tables back to markdown', () => {
    expect(tableToMarkdown(node)).toBe([
      '| Name | Role | Score |',
      '| :--- | ---: | :---: |',
      '| Ada | Admin | 3 |'
    ].join('\n'))
  })
})
