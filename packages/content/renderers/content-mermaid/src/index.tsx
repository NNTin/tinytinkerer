import mermaidRuntimeUrl from 'mermaid/dist/mermaid.min.js?url'
import { useEffect, useId, useState } from 'react'
import {
  CodeBlockFallback,
  PreviewCodeFrame,
  sanitizeSvgMarkup,
  type CodeBlockNode,
  type ContentNodeRendererProps,
  type ReactNodeRendererPlugin
} from '@tinytinkerer/content-react'

export type MermaidRenderResult = {
  svg: string
}

export type MermaidParseResult = boolean | { diagramType: string } | undefined

export type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void
  parse?: (
    code: string,
    options?: { suppressErrors?: boolean }
  ) => Promise<MermaidParseResult> | MermaidParseResult
  render: (id: string, code: string) => Promise<MermaidRenderResult>
}

declare global {
  interface Window {
    mermaid?: MermaidApi
  }
}

export type MermaidRenderTheme = 'default' | 'dark'

let mermaidPromise: Promise<MermaidApi> | null = null
let appliedTheme: MermaidRenderTheme | null = null

export const resetMermaidState = (): void => {
  mermaidPromise = null
  appliedTheme = null
}

// Mermaid's theme lives in global config, so switching themes between renders
// (e.g. chat preview vs. export dialog) means re-initializing only when the
// requested theme actually differs from what's currently applied.
const applyMermaidConfig = (mermaid: MermaidApi, theme: MermaidRenderTheme): MermaidApi => {
  if (appliedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme
    })
    appliedTheme = theme
  }

  return mermaid
}

// Serializes initialize+render pairs so a concurrent render can never observe
// (or clobber) another render's theme mid-flight.
let renderChain: Promise<unknown> = Promise.resolve()
const withMermaidRenderLock = <T,>(task: () => Promise<T>): Promise<T> => {
  const run = renderChain.then(task, task)
  renderChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

// Loading only guarantees the runtime is configured at least once; it must not
// re-apply a theme, or a caller on this fast path would clobber the theme of a
// render currently holding the lock.
const ensureMermaidConfigured = (mermaid: MermaidApi): MermaidApi =>
  appliedTheme === null ? applyMermaidConfig(mermaid, 'default') : mermaid

export const loadMermaidRuntime = (): Promise<MermaidApi> => {
  const existingMermaid = window.mermaid
  if (existingMermaid) {
    return Promise.resolve(ensureMermaidConfigured(existingMermaid))
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

      resolve(ensureMermaidConfigured(mermaid))
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

export type MermaidDiagnostic = { message: string; line?: number; column?: number }

export const toMermaidDiagnostic = (error: unknown): MermaidDiagnostic => {
  const message = error instanceof Error ? error.message : String(error)
  const lineMatch = message.match(/line\s+(\d+)/i)
  const columnMatch = message.match(/column\s+(\d+)/i)
  return {
    message,
    ...(lineMatch?.[1] ? { line: Number(lineMatch[1]) } : {}),
    ...(columnMatch?.[1] ? { column: Number(columnMatch[1]) } : {})
  }
}

export const renderMermaidSource = async (
  code: string,
  id: string,
  options: { theme?: MermaidRenderTheme } = {}
): Promise<{ svg: string }> => {
  const mermaid = await loadMermaidRuntime()
  return withMermaidRenderLock(async () => {
    applyMermaidConfig(mermaid, options.theme ?? 'default')
    if (typeof mermaid.parse === 'function') {
      const parsed = await mermaid.parse(code)
      if (parsed === false) throw new Error('Invalid Mermaid syntax')
    }
    const result = await mermaid.render(id, code)
    return { svg: sanitizeSvgMarkup(result.svg) }
  })
}

export const validateMermaidSource = async (code: string): Promise<MermaidDiagnostic | null> => {
  if (code.trim().length === 0) return null
  try {
    const mermaid = await loadMermaidRuntime()
    if (typeof mermaid.parse === 'function') {
      const parsed = await mermaid.parse(code)
      if (parsed === false) return { message: 'Invalid Mermaid syntax' }
    }
    return null
  } catch (error) {
    return toMermaidDiagnostic(error)
  }
}

export const MermaidNodeRenderer = ({ node }: ContentNodeRendererProps<CodeBlockNode>) => {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const id = useId().replace(/:/g, '-')

  useEffect(() => {
    let cancelled = false
    const mermaid = window.mermaid

    if (!mermaid) {
      console.error('[content-mermaid] render failed:', new Error('Mermaid runtime is not loaded'))
      setFailed(true)
      return () => {
        cancelled = true
      }
    }

    const preflight: Promise<MermaidParseResult> =
      typeof mermaid.parse === 'function'
        ? Promise.resolve(mermaid.parse(node.code, { suppressErrors: true }))
        : Promise.resolve(true)

    void preflight
      .then((parseResult) => {
        if (cancelled) {
          return
        }
        if (parseResult === false) {
          // Incomplete or invalid syntax (commonly mid-stream). Skip rendering
          // so mermaid's "Syntax error" SVG never enters the chrome, and keep
          // the preview slot open so a later valid snapshot can take over.
          setSvg(null)
          setFailed(false)
          return
        }
        return withMermaidRenderLock(() => {
          applyMermaidConfig(mermaid, 'default')
          return mermaid.render(`tt-mermaid-${id}`, node.code)
        }).then((result) => {
          if (cancelled) {
            return
          }
          // Reuse the shared, hardened SVG sanitization policy (see
          // @tinytinkerer/content-react) so the mermaid and raw-inline-SVG render
          // paths never fork their DOMPurify configuration.
          const sanitized = sanitizeSvgMarkup(result.svg)
          setSvg(sanitized)
          setFailed(false)
        })
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
        <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
          Mermaid
        </span>
      }
      code={node.code}
      codeLanguage="mermaid"
      showPreview={!failed}
      preview={
        svg ? (
          <div
            aria-label="Mermaid diagram"
            className="bg-white p-4"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <CodeBlockFallback code={node.code} language="mermaid" />
        )
      }
    />
  )
}

export const createMermaidPlugin = (): ReactNodeRendererPlugin<'codeBlock'> => {
  return {
    id: 'mermaid',
    nodeType: 'codeBlock',
    priority: 50,
    requirements: { lazy: true, clientOnly: true, needsDom: true },
    matches: (node) => node.language === 'mermaid',
    load: () => loadMermaidRuntime().then(() => undefined),
    render: (node) => <MermaidNodeRenderer node={node} />,
    fallback: (node) => <CodeBlockFallback code={node.code} language={node.language ?? 'mermaid'} />
  }
}

export const mermaidPlugin: ReactNodeRendererPlugin<'codeBlock'> = createMermaidPlugin()
