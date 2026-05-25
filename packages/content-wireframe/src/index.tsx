import { useState } from 'react'
import type { WireframeNode } from '@tinytinkerer/content-core'
import { CodeBlockFallback, type ContentNodeRendererProps } from '@tinytinkerer/content-react'

const BUTTON_BASE = 'text-[11px] font-medium transition-colors px-1.5 py-0.5 rounded'
const BUTTON_IDLE = 'text-stone-500 hover:text-stone-700'
const BUTTON_ACTIVE = 'bg-stone-100 text-stone-700'

export const WireframeNodeRenderer = ({ node }: ContentNodeRendererProps<WireframeNode>) => {
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [copied, setCopied] = useState(false)

  if (!node.code.trim()) {
    return <CodeBlockFallback code={node.code} language="wireframe" />
  }

  const copy = () => {
    void navigator.clipboard.writeText(node.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      data-tt-wireframe=""
      className="overflow-hidden rounded-lg border border-stone-200 bg-stone-50"
    >
      <div className="flex items-center justify-between border-b border-stone-200 bg-white px-3 py-2">
        <div className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300" />
          <span className="ml-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">Wireframe</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView('preview')}
            className={`${BUTTON_BASE} ${view === 'preview' ? BUTTON_ACTIVE : BUTTON_IDLE}`}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setView('code')}
            className={`${BUTTON_BASE} ${view === 'code' ? BUTTON_ACTIVE : BUTTON_IDLE}`}
          >
            Code
          </button>
          <span className="mx-1 h-3 w-px bg-stone-200" />
          <button type="button" onClick={copy} className={`${BUTTON_BASE} ${BUTTON_IDLE}`}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      {view === 'preview' ? (
        <iframe
          srcDoc={node.code}
          title="Wireframe preview"
          sandbox="allow-same-origin allow-scripts"
          className="h-64 w-full border-0 bg-white"
        />
      ) : (
        <CodeBlockFallback code={node.code} language="html" />
      )}
    </div>
  )
}
