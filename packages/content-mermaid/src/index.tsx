import DOMPurify from 'dompurify'
import mermaidRuntimeUrl from 'mermaid/dist/mermaid.min.js?url'
import { useEffect, useId, useState } from 'react'
import type { MermaidNode } from '@tinytinkerer/content-core'
import { CodeBlockFallback, type ContentNodeRendererProps } from '@tinytinkerer/content-react'

type MermaidRenderResult = {
  svg: string
}

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, code: string) => Promise<MermaidRenderResult>
}

declare global {
  interface Window {
    mermaid?: MermaidApi
  }
}

let mermaidPromise: Promise<MermaidApi> | null = null
let hasInitializedMermaid = false

export const resetMermaidState = (): void => {
  mermaidPromise = null
  hasInitializedMermaid = false
}

const initializeMermaid = (mermaid: MermaidApi): MermaidApi => {
  if (!hasInitializedMermaid) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict'
    })
    hasInitializedMermaid = true
  }

  return mermaid
}

const loadMermaid = (): Promise<MermaidApi> => {
  const existingMermaid = window.mermaid
  if (existingMermaid) {
    return Promise.resolve(initializeMermaid(existingMermaid))
  }

  mermaidPromise ??= new Promise<MermaidApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.src = mermaidRuntimeUrl
    script.dataset.ttMermaidRuntime = 'true'
    script.onload = () => {
      const mermaid = window.mermaid
      if (!mermaid) {
        reject(new Error('Mermaid runtime did not expose a global API'))
        return
      }

      resolve(initializeMermaid(mermaid))
    }
    script.onerror = () => {
      reject(new Error('Failed to load Mermaid runtime'))
    }

    document.head.append(script)
  }).catch((error) => {
    mermaidPromise = null
    throw error
  })

  return mermaidPromise
}

const BUTTON_BASE = 'text-[11px] font-medium transition-colors px-1.5 py-0.5 rounded'
const BUTTON_IDLE = 'text-stone-500 hover:text-stone-700'
const BUTTON_ACTIVE = 'bg-stone-100 text-stone-700'

export const MermaidNodeRenderer = ({ node }: ContentNodeRendererProps<MermaidNode>) => {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [copied, setCopied] = useState(false)
  const id = useId().replace(/:/g, '-')

  useEffect(() => {
    let cancelled = false

    void loadMermaid()
      .then((mermaid) => mermaid.render(`tt-mermaid-${id}`, node.code))
      .then((result) => {
        if (!cancelled) {
          const sanitized = DOMPurify.sanitize(result.svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            ADD_TAGS: ['foreignObject', 'div', 'span', 'p', 'br'],
            // foreignObject is an HTML integration point in SVG; without this,
            // DOMPurify rejects all HTML children (div, span, p) inside it, stripping
            // node labels from flowchart and class diagrams entirely.
            HTML_INTEGRATION_POINTS: { 'annotation-xml': true, 'foreignobject': true }
          })
          setSvg(sanitized)
        }
      })
      .catch((error: unknown) => {
        console.error('[content-mermaid] render failed:', error)
        if (!cancelled) {
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [id, node.code])

  const copy = () => {
    void navigator.clipboard.writeText(node.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const showPreviewButton = !failed

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
      <div className="flex items-center justify-between border-b border-stone-200 bg-white px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Mermaid</span>
        <div className="flex items-center gap-1">
          {showPreviewButton && (
            <button
              type="button"
              onClick={() => setView('preview')}
              className={`${BUTTON_BASE} ${view === 'preview' ? BUTTON_ACTIVE : BUTTON_IDLE}`}
            >
              Preview
            </button>
          )}
          <button
            type="button"
            onClick={() => setView('code')}
            className={`${BUTTON_BASE} ${!showPreviewButton || view === 'code' ? BUTTON_ACTIVE : BUTTON_IDLE}`}
          >
            Code
          </button>
          <span className="mx-1 h-3 w-px bg-stone-200" />
          <button type="button" onClick={copy} className={`${BUTTON_BASE} ${BUTTON_IDLE}`}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      {view === 'preview' && !failed ? (
        svg ? (
          <div aria-label="Mermaid diagram" className="bg-white p-4" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <CodeBlockFallback code={node.code} language="mermaid" />
        )
      ) : (
        <CodeBlockFallback code={node.code} language="mermaid" />
      )}
    </div>
  )
}
