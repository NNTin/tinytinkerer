// The ONE module in this framework that imports the real content platform
// runtime. It must only ever be reached through a dynamic import() (see
// RichContentPlayground.tsx's `React.lazy`, itself gated behind Docusaurus's
// <BrowserOnly>) so a page with no <RichContentPlayground> never downloads
// this chunk, and a static build never executes it (issue #455: "lazy-load
// editor and specialized renderer bundles only on pages containing the
// playground").
import { useState } from 'react'
import {
  ContentPlaygroundPreview,
  parsePlaygroundMarkdown,
  resolvePlaygroundNodePlugin,
  useCopyButtonState,
  type ContentNode
} from '@tinytinkerer/app-browser'
import '@tinytinkerer/app-browser/styles.css'
import { LabContainer } from '../components/lab-container'
import {
  DEFAULT_PLAYGROUND_EXAMPLE_ID,
  findPlaygroundExample,
  PLAYGROUND_EXAMPLES
} from './constants'
import { readExampleIdFromSearch, withExampleIdInSearch } from './url-param'

const initialExampleId = (): string =>
  findPlaygroundExample(readExampleIdFromSearch(window.location.search))?.id ??
  DEFAULT_PLAYGROUND_EXAMPLE_ID

// A codeBlock/table's block-level children (blockquote → BlockNode[], list →
// listItem.children flattened) — the only two container shapes in the AST
// that nest further ContentNodes the runtime independently dispatches.
const blockChildrenOf = (node: ContentNode): readonly ContentNode[] => {
  if (node.type === 'blockquote') {
    return node.children
  }
  if (node.type === 'list') {
    return node.children.flatMap((item) => item.children)
  }
  return []
}

const nodeDetail = (node: ContentNode): string | null => {
  switch (node.type) {
    case 'heading':
      return `level ${node.level}`
    case 'codeBlock':
      return node.language ?? 'no language'
    case 'image':
      return node.alt || node.url
    default:
      return null
  }
}

const AstNode = ({ node }: { node: ContentNode }) => {
  const resolution = resolvePlaygroundNodePlugin(node)
  const detail = nodeDetail(node)
  const children = blockChildrenOf(node)

  return (
    <li>
      <code>{node.type}</code>
      {detail ? <span className="rich-content-playground__ast-detail"> {detail}</span> : null}{' '}
      <span
        className={
          resolution.ok
            ? 'rich-content-playground__ast-plugin'
            : 'rich-content-playground__ast-plugin rich-content-playground__ast-plugin--fallback'
        }
      >
        {resolution.ok ? resolution.pluginId : `fallback (${resolution.reason})`}
      </span>
      {children.length > 0 ? (
        <ul>
          {children.map((child) => (
            <AstNode key={child.id ?? `${child.type}-${node.id}`} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export type PlaygroundClientRuntimeProps = { title: string }

export default function PlaygroundClientRuntime({ title }: PlaygroundClientRuntimeProps) {
  const [exampleId, setExampleId] = useState<string>(initialExampleId)
  const example = findPlaygroundExample(exampleId) ?? PLAYGROUND_EXAMPLES[0]
  const [source, setSource] = useState<string>(example.markdown)
  const { copied, copy } = useCopyButtonState(source)

  const handleSelectExample = (id: string) => {
    const next = findPlaygroundExample(id)
    if (!next) {
      return
    }
    setExampleId(next.id)
    setSource(next.markdown)
    const nextUrl = `${window.location.pathname}${withExampleIdInSearch(window.location.search, next.id)}${window.location.hash}`
    window.history.replaceState(null, '', nextUrl)
  }

  const handleReset = () => {
    setSource(example.markdown)
  }

  // Synchronous, in-memory, no model/network call — issue #455's core
  // acceptance criterion.
  const contentDocument = parsePlaygroundMarkdown(source)

  return (
    <LabContainer title={title} status="ready">
      <div className="rich-content-playground">
        <div className="rich-content-playground__toolbar">
          <label className="rich-content-playground__field">
            <span>Example</span>
            <select value={exampleId} onChange={(event) => handleSelectExample(event.target.value)}>
              {PLAYGROUND_EXAMPLES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={handleReset}>
            Reset
          </button>
          <button type="button" onClick={copy}>
            {copied ? 'Copied!' : 'Copy source'}
          </button>
        </div>
        <p className="rich-content-playground__description">{example.description}</p>
        <div className="rich-content-playground__panes">
          <div className="rich-content-playground__pane">
            <label
              className="rich-content-playground__pane-label"
              htmlFor="rich-content-playground-source"
            >
              Source
            </label>
            <textarea
              id="rich-content-playground-source"
              className="rich-content-playground__source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              spellCheck={false}
              rows={14}
            />
          </div>
          <div className="rich-content-playground__pane">
            <span className="rich-content-playground__pane-label">Preview</span>
            <div className="rich-content-playground__preview">
              <ContentPlaygroundPreview document={contentDocument} className="prose-assistant" />
            </div>
          </div>
        </div>
        <details className="rich-content-playground__ast">
          <summary>Semantic document (AST) and selected renderer plugin</summary>
          <ul className="rich-content-playground__ast-list">
            {contentDocument.nodes.map((node) => (
              <AstNode key={node.id} node={node} />
            ))}
          </ul>
        </details>
      </div>
    </LabContainer>
  )
}
