import { useState } from 'react'
import {
  renderInline,
  tableToMarkdown,
  useCopyButtonState,
  type ContentNodeRendererProps,
  type ReactNodeRendererPlugin,
  type TableCell,
  type TableNode
} from '@tinytinkerer/content-react'

const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/

const escapeCsvField = (value: string): string => {
  // Prefix cells that would otherwise be interpreted as formulas in
  // spreadsheet applications. Apostrophe is the canonical OWASP mitigation.
  const guarded = FORMULA_INJECTION_PREFIX.test(value) ? `'${value}` : value
  const needsQuotes = /[",\r\n]/.test(guarded)
  const escaped = guarded.replace(/"/g, '""')
  return needsQuotes ? `"${escaped}"` : escaped
}

const cellPlainText = (cell: TableCell): string => {
  let text = ''
  for (const node of cell) {
    if (node.type === 'text' || node.type === 'codeInline') {
      text += node.value
    } else if (
      node.type === 'emphasis' ||
      node.type === 'strong' ||
      node.type === 'strikethrough' ||
      node.type === 'link'
    ) {
      text += cellPlainText(node.children)
    } else if (node.type === 'imageInline') {
      text += node.alt
    } else if (node.type === 'break') {
      text += ' '
    }
  }
  return text
}

export const tableToCsv = (node: TableNode): string => {
  const width = node.header.length
  const lines: string[] = []
  lines.push(
    Array.from({ length: width }, (_, index) =>
      escapeCsvField(cellPlainText(node.header[index] ?? []))
    ).join(',')
  )
  for (const row of node.rows) {
    lines.push(
      Array.from({ length: width }, (_, index) =>
        escapeCsvField(cellPlainText(row[index] ?? []))
      ).join(',')
    )
  }
  return lines.join('\n')
}

type TableHeader = readonly TableCell[]
type TableRow = readonly TableCell[]

const triggerDownload = (filename: string, content: string): void => {
  if (typeof document === 'undefined') {
    return
  }
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const ResponsiveCardLayout = ({
  header,
  rows
}: {
  header: TableHeader
  rows: readonly TableRow[]
}) => (
  <div data-tt-table-cards="" className="flex flex-col gap-2 md:hidden">
    {rows.map((row, rowIndex) => (
      <dl
        key={`card-${rowIndex}-${row.map((cell) => cell.map((item) => item.id ?? item.type).join('-')).join('|')}`}
        className="rounded-md border border-stone-200 bg-white p-2 text-[13px]"
      >
        {header.map((headerCell, cellIndex) => {
          const cell = row[cellIndex] ?? []
          const headerKey = `card-${rowIndex}-h-${cellIndex}-${headerCell.map((item) => item.id ?? item.type).join('-')}`
          const valueKey = `card-${rowIndex}-v-${cellIndex}-${cell.map((item) => item.id ?? item.type).join('-')}`
          return (
            <div key={`pair-${rowIndex}-${cellIndex}`} className="flex gap-2 py-1">
              <dt key={headerKey} className="min-w-[6rem] font-medium text-stone-500">
                {renderInline(headerCell)}
              </dt>
              <dd key={valueKey} className="flex-1 text-stone-800">
                {renderInline(cell)}
              </dd>
            </div>
          )
        })}
      </dl>
    ))}
  </div>
)

const TableMarkup = ({ node }: { node: TableNode }) => (
  <div className="hidden md:block">
    <table className="w-full border-collapse text-[13px]">
      <thead className="sticky top-0 z-10 bg-stone-50">
        <tr>
          {node.header.map((cell, index) => (
            <th
              key={`header-${index}-${cell.map((item) => item.id ?? item.type).join('-')}`}
              align={node.align[index] ?? undefined}
              className="border-b border-stone-200 px-3 py-2 text-left font-semibold text-stone-700"
            >
              {renderInline(cell)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {node.rows.map((row, rowIndex) => (
          <tr
            key={`row-${rowIndex}-${row.map((cell) => cell.map((item) => item.id ?? item.type).join('-')).join('|')}`}
            className="border-b border-stone-100 transition-colors hover:bg-stone-50"
          >
            {row.map((cell, cellIndex) => (
              <td
                key={`cell-${rowIndex}-${cellIndex}-${cell.map((item) => item.id ?? item.type).join('-')}`}
                align={node.align[cellIndex] ?? undefined}
                className="px-3 py-2"
              >
                {renderInline(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const BUTTON_CLASS =
  'rounded px-1.5 py-0.5 text-[11px] font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700'

export const TableNodeRenderer = ({ node }: ContentNodeRendererProps<TableNode>) => {
  const markdown = tableToMarkdown(node)
  const { copied, copy } = useCopyButtonState(markdown)
  const [csvCopied, setCsvCopied] = useState(false)

  const handleDownloadCsv = () => {
    triggerDownload('table.csv', tableToCsv(node))
    setCsvCopied(true)
    window.setTimeout(() => setCsvCopied(false), 2000)
  }

  return (
    <div
      data-tt-table=""
      className="relative my-3 max-h-[420px] overflow-auto rounded-md border border-stone-200"
    >
      <div className="sticky top-0 z-20 flex items-center justify-end gap-1 border-b border-stone-200 bg-white/90 px-2 py-1 backdrop-blur">
        <button type="button" onClick={copy} className={BUTTON_CLASS}>
          {copied ? 'Copied!' : 'Copy MD'}
        </button>
        <button
          type="button"
          onClick={handleDownloadCsv}
          className={BUTTON_CLASS}
          aria-label="Download as CSV"
        >
          {csvCopied ? 'Saved!' : 'CSV'}
        </button>
      </div>
      <TableMarkup node={node} />
      <ResponsiveCardLayout header={node.header} rows={node.rows} />
    </div>
  )
}

export const createTablePlugin = (): ReactNodeRendererPlugin<'table'> => ({
  id: 'table',
  nodeType: 'table',
  priority: 10,
  render: (node) => <TableNodeRenderer node={node} />
})

export const tablePlugin: ReactNodeRendererPlugin<'table'> = createTablePlugin()
