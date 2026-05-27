// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TableNode } from '@tinytinkerer/content-react'
import {
  createTablePlugin,
  TableNodeRenderer,
  tableToCsv,
  tablePlugin
} from '../src/index.js'

afterEach(() => {
  cleanup()
})

const sampleTable: TableNode = {
  type: 'table',
  align: ['left', 'right', 'center'],
  header: [
    [{ type: 'text', value: 'Name' }],
    [{ type: 'text', value: 'Role' }],
    [{ type: 'text', value: 'Score' }]
  ],
  rows: [
    [
      [{ type: 'text', value: 'Ada' }],
      [{ type: 'text', value: 'Admin' }],
      [{ type: 'text', value: '3' }]
    ],
    [
      [{ type: 'text', value: 'Bea' }],
      [{ type: 'text', value: 'User' }],
      [{ type: 'text', value: '7' }]
    ]
  ]
}

describe('tablePlugin', () => {
  it('exports the table plugin for composition', () => {
    expect(tablePlugin.nodeType).toBe('table')
    expect(typeof tablePlugin.render).toBe('function')
  })

  it('creates isolated plugin instances on demand', () => {
    const left = createTablePlugin()
    const right = createTablePlugin()

    expect(left).not.toBe(right)
    expect(left.id).toBe('table')
    expect(right.id).toBe('table')
  })
})

describe('TableNodeRenderer', () => {
  it('renders semantic table markup with sticky header styles', () => {
    const { container } = render(<TableNodeRenderer node={sampleTable} />)

    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('thead')?.className).toContain('sticky')
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('align', 'left')
    expect(screen.getByRole('columnheader', { name: 'Role' })).toHaveAttribute('align', 'right')
  })

  it('renders a responsive card layout alongside the desktop table', () => {
    const { container } = render(<TableNodeRenderer node={sampleTable} />)
    expect(container.querySelector('[data-tt-table-cards]')).not.toBeNull()
  })

  it('copies markdown to the clipboard when Copy MD is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<TableNodeRenderer node={sampleTable} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy MD' }))

    expect(writeText).toHaveBeenCalledWith(
      [
        '| Name | Role | Score |',
        '| :--- | ---: | :---: |',
        '| Ada | Admin | 3 |',
        '| Bea | User | 7 |'
      ].join('\n')
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument())
  })

  it('triggers a CSV download when the CSV button is clicked', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })

    render(<TableNodeRenderer node={sampleTable} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download as CSV' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('shows hover-highlight transition class on body rows', () => {
    const { container } = render(<TableNodeRenderer node={sampleTable} />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.className).toContain('hover:bg-stone-50')
    }
  })
})

describe('tableToCsv', () => {
  it('serializes table cells to CSV', () => {
    expect(tableToCsv(sampleTable)).toBe(
      ['Name,Role,Score', 'Ada,Admin,3', 'Bea,User,7'].join('\n')
    )
  })

  it('quotes fields containing commas or quotes', () => {
    expect(
      tableToCsv({
        type: 'table',
        align: [null, null],
        header: [
          [{ type: 'text', value: 'a' }],
          [{ type: 'text', value: 'b' }]
        ],
        rows: [
          [
            [{ type: 'text', value: 'hello, world' }],
            [{ type: 'text', value: 'a "quoted" value' }]
          ]
        ]
      })
    ).toBe(['a,b', '"hello, world","a ""quoted"" value"'].join('\n'))
  })

  it('prefixes formula-injection-prone cells with an apostrophe', () => {
    expect(
      tableToCsv({
        type: 'table',
        align: [null, null, null, null],
        header: [
          [{ type: 'text', value: 'a' }],
          [{ type: 'text', value: 'b' }],
          [{ type: 'text', value: 'c' }],
          [{ type: 'text', value: 'd' }]
        ],
        rows: [
          [
            [{ type: 'text', value: '=SUM(A1)' }],
            [{ type: 'text', value: '+1+1' }],
            [{ type: 'text', value: '-1' }],
            [{ type: 'text', value: '@cmd' }]
          ]
        ]
      })
    ).toBe(['a,b,c,d', "'=SUM(A1),'+1+1,'-1,'@cmd"].join('\n'))
  })

  it('pads short rows to header width to keep CSV columns aligned', () => {
    expect(
      tableToCsv({
        type: 'table',
        align: [null, null, null],
        header: [
          [{ type: 'text', value: 'name' }],
          [{ type: 'text', value: 'role' }],
          [{ type: 'text', value: 'score' }]
        ],
        rows: [
          [[{ type: 'text', value: 'Ada' }], [{ type: 'text', value: 'Admin' }]]
        ]
      })
    ).toBe(['name,role,score', 'Ada,Admin,'].join('\n'))
  })
})
