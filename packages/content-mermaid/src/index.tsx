import DOMPurify from 'dompurify'
import mermaidRuntimeUrl from 'mermaid/dist/mermaid.min.js?url'
import { useEffect, useId, useState } from 'react'
import {
  CodeBlockFallback,
  PreviewCodeFrame,
  type ContentNodeRendererProps,
  type MermaidNode,
  type ReactContentRendererRegistry,
  type ReactNodeRendererPlugin
} from '@tinytinkerer/content-react'

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

export const MermaidNodeRenderer = ({ node }: ContentNodeRendererProps<MermaidNode>) => {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
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

  return (
    <PreviewCodeFrame
      headerStart={
        <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Mermaid</span>
      }
      code={node.code}
      codeLanguage="mermaid"
      showPreview={!failed}
      preview={
        svg ? (
          <div aria-label="Mermaid diagram" className="bg-white p-4" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <CodeBlockFallback code={node.code} language="mermaid" />
        )
      }
    />
  )
}

export const mermaidPlugin: ReactNodeRendererPlugin<'mermaid'> = {
  id: 'mermaid',
  nodeType: 'mermaid',
  capabilities: { lazy: true, preview: true },
  load: () => loadMermaid().then(() => undefined),
  render: (node) => <MermaidNodeRenderer node={node} />,
  fallback: (node) => <CodeBlockFallback code={node.code} language="mermaid" />
}

// Legacy renderer-map export retained for callers still wiring renderers via the
// ReactContentRendererRegistry shape. New callers should register `mermaidPlugin`
// against a ContentRuntime instead.
export const mermaidRenderers = {
  mermaid: MermaidNodeRenderer
} satisfies Pick<ReactContentRendererRegistry, 'mermaid'>
