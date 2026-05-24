/// <reference path="./assets.d.ts" />
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
          setSvg(result.svg)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [id, node.code])

  if (failed) {
    return <CodeBlockFallback code={node.code} language="mermaid" />
  }

  if (!svg) {
    return <CodeBlockFallback code={node.code} language="mermaid" />
  }

  return <div aria-label="Mermaid diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}
