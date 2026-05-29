import { Fragment, useMemo, type ReactNode } from 'react'
import { parseMarkdownContent } from '@tinytinkerer/content-markdown'
import type {
  BlockNode,
  ContentDocument,
  InlineNode,
  ListItemNode,
  TableAlignment,
  TableNode
} from '@tinytinkerer/contracts'

type MarkdownDocumentProps = {
  markdown: string
  className?: string
}

const joinClasses = (...values: Array<string | undefined>) => values.filter(Boolean).join(' ')

const renderInline = (nodes: readonly InlineNode[]): ReactNode =>
  nodes.map((node, index) => {
    const key = node.id ?? `${node.type}-${index}`
    switch (node.type) {
      case 'text':
        return <Fragment key={key}>{node.value}</Fragment>
      case 'emphasis':
        return (
          <em key={key} className="italic">
            {renderInline(node.children)}
          </em>
        )
      case 'strong':
        return (
          <strong key={key} className="font-semibold">
            {renderInline(node.children)}
          </strong>
        )
      case 'strikethrough':
        return (
          <del key={key} className="line-through">
            {renderInline(node.children)}
          </del>
        )
      case 'codeInline':
        return (
          <code key={key} className="rounded bg-stone-100 px-1 font-mono text-xs">
            {node.value}
          </code>
        )
      case 'link': {
        const external = /^https?:/i.test(node.url)
        return (
          <a
            key={key}
            href={node.url}
            title={node.title}
            className="text-amber-700 underline underline-offset-2 hover:text-amber-800"
            {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            {renderInline(node.children)}
          </a>
        )
      }
      case 'imageInline':
        return (
          <img
            key={key}
            className="inline max-w-full align-middle"
            src={node.url}
            alt={node.alt}
            title={node.title}
          />
        )
      case 'break':
        return <br key={key} />
    }
  })

const tableAlign = (align: TableAlignment) => (align === null ? undefined : align)

const renderListItem = (node: ListItemNode) => (
  <li key={node.id} className="my-1">
    <div className={joinClasses('min-w-0', typeof node.checked === 'boolean' ? 'flex items-start gap-2' : undefined)}>
      {typeof node.checked === 'boolean' ? (
        <span className="mt-0.5 inline-flex shrink-0">
          <input type="checkbox" defaultChecked={node.checked} disabled />
        </span>
      ) : null}
      <div className="min-w-0">
        {node.children.map((child) => (
          <Fragment key={child.id}>{renderBlock(child)}</Fragment>
        ))}
      </div>
    </div>
  </li>
)

const renderTable = (node: TableNode) => (
  <div key={node.id} className="my-4 overflow-x-auto">
    <table className="min-w-full border-collapse text-left text-sm text-stone-700">
      <thead>
        <tr className="border-b border-stone-300">
          {node.header.map((cell, index) => (
            <th
              key={`header-${index}-${cell.map((item) => item.id ?? item.type).join('-')}`}
              align={tableAlign(node.align[index] ?? null)}
              className="border border-stone-200 bg-stone-50 px-3 py-2 font-semibold"
            >
              {renderInline(cell)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {node.rows.map((row, rowIndex) => (
          <tr key={`row-${rowIndex}`} className="border-b border-stone-200">
            {row.map((cell, cellIndex) => (
              <td
                key={`cell-${rowIndex}-${cellIndex}-${cell.map((item) => item.id ?? item.type).join('-')}`}
                align={tableAlign(node.align[cellIndex] ?? null)}
                className="border border-stone-200 px-3 py-2 align-top"
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

const renderHeading = (node: Extract<BlockNode, { type: 'heading' }>) => {
  const content = renderInline(node.children)
  switch (node.level) {
    case 1:
      return (
        <h1 key={node.id} className="mt-5 mb-3 text-xl font-semibold text-stone-900">
          {content}
        </h1>
      )
    case 2:
      return (
        <h2 key={node.id} className="mt-5 mb-3 text-lg font-semibold text-stone-900">
          {content}
        </h2>
      )
    case 3:
      return (
        <h3 key={node.id} className="mt-4 mb-2 text-base font-semibold text-stone-900">
          {content}
        </h3>
      )
    case 4:
      return (
        <h4 key={node.id} className="mt-4 mb-2 text-sm font-semibold text-stone-900">
          {content}
        </h4>
      )
    case 5:
      return (
        <h5 key={node.id} className="mt-4 mb-2 text-sm font-semibold text-stone-900">
          {content}
        </h5>
      )
    case 6:
      return (
        <h6 key={node.id} className="mt-4 mb-2 text-sm font-semibold text-stone-900">
          {content}
        </h6>
      )
  }
}

const renderBlock = (node: BlockNode): ReactNode => {
  switch (node.type) {
    case 'heading':
      return renderHeading(node)
    case 'paragraph':
      return (
        <p key={node.id} className="my-2 text-sm leading-relaxed text-stone-700">
          {renderInline(node.children)}
        </p>
      )
    case 'list': {
      const items = node.children.map(renderListItem)
      if (node.ordered) {
        return (
          <ol
            key={node.id}
            className="my-2 list-decimal pl-5 text-sm leading-relaxed text-stone-700"
            start={node.start}
          >
            {items}
          </ol>
        )
      }
      return (
        <ul key={node.id} className="my-2 list-disc pl-5 text-sm leading-relaxed text-stone-700">
          {items}
        </ul>
      )
    }
    case 'blockquote':
      return (
        <blockquote
          key={node.id}
          className="my-2 border-l-2 border-stone-300 pl-3 text-sm leading-relaxed text-stone-600"
        >
          {node.children.map((child) => (
            <Fragment key={child.id}>{renderBlock(child)}</Fragment>
          ))}
        </blockquote>
      )
    case 'thematicBreak':
      return <hr key={node.id} className="my-4 border-stone-200" />
    case 'codeBlock':
      return (
        <pre
          key={node.id}
          className="my-2 overflow-x-auto rounded bg-stone-100 p-3 font-mono text-xs leading-relaxed text-stone-800"
        >
          <code>{node.code}</code>
        </pre>
      )
    case 'table':
      return renderTable(node)
    case 'image':
      return (
        <img
          key={node.id}
          className="my-2 max-w-full"
          src={node.url}
          alt={node.alt}
          title={node.title}
        />
      )
    default:
      return null
  }
}

export const MarkdownDocument = ({ markdown, className }: MarkdownDocumentProps) => {
  const document = useMemo<ContentDocument>(() => parseMarkdownContent(markdown), [markdown])

  return (
    <div className={joinClasses('text-sm text-stone-700', className)}>
      {document.nodes.map((node) => (
        <Fragment key={node.id}>{renderBlock(node)}</Fragment>
      ))}
    </div>
  )
}
