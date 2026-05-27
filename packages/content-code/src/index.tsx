import { useEffect, useMemo, useState } from 'react'
import {
  PreviewCodeFrame,
  type CodeBlockNode,
  type ContentNodeRendererProps,
  type ReactNodeRendererPlugin
} from '@tinytinkerer/content-react'
import {
  HLJS_INLINE_CSS,
  escapeCodeHtml,
  getHighlighter,
  loadHighlighter,
  renderHighlighted
} from './highlighter.js'

export { resetHighlighterState } from './highlighter.js'

const STYLE_ELEMENT_ID = 'tt-content-code-highlighter-styles'

const ensureHighlighterStyles = () => {
  if (typeof document === 'undefined') {
    return
  }
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.textContent = HLJS_INLINE_CSS
  document.head.append(style)
}

const HIGHLIGHTER_LANGUAGE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  yml: 'yaml',
  jsonc: 'json',
  sh: 'bash',
  zsh: 'bash',
  shell: 'shell',
  html: 'xml',
  md: 'markdown'
}

const resolveLanguage = (language: string): string => {
  const lower = language.toLowerCase()
  return HIGHLIGHTER_LANGUAGE_ALIASES[lower] ?? lower
}

type SpecializedLanguage = 'diff' | 'json' | 'yaml' | 'http' | 'sql' | 'bash'

const classifyLanguage = (language: string): SpecializedLanguage | 'generic' => {
  const lower = language.toLowerCase()
  if (lower === 'diff' || lower === 'patch') {
    return 'diff'
  }
  if (lower === 'json' || lower === 'jsonc') {
    return 'json'
  }
  if (lower === 'yaml' || lower === 'yml') {
    return 'yaml'
  }
  if (lower === 'http') {
    return 'http'
  }
  if (lower === 'sql') {
    return 'sql'
  }
  if (lower === 'bash' || lower === 'sh' || lower === 'zsh' || lower === 'shell') {
    return 'bash'
  }
  return 'generic'
}

const labelForLanguage = (language: string): string => {
  const cleaned = language.trim()
  if (cleaned.length === 0) {
    return 'Code'
  }
  return cleaned.toUpperCase()
}

const HighlightedCode = ({ code, language }: { code: string; language: string }) => {
  const resolved = resolveLanguage(language)
  const [html, setHtml] = useState(() =>
    getHighlighter() ? renderHighlighted(code, resolved) : escapeCodeHtml(code)
  )

  useEffect(() => {
    ensureHighlighterStyles()
  }, [])

  useEffect(() => {
    if (getHighlighter()) {
      setHtml(renderHighlighted(code, resolved))
      return
    }
    let cancelled = false
    void loadHighlighter()
      .then(() => {
        if (!cancelled) {
          setHtml(renderHighlighted(code, resolved))
        }
      })
      .catch(() => {
        // Stay on the plain fallback; nothing to do.
      })
    return () => {
      cancelled = true
    }
  }, [code, resolved])

  return (
    <pre
      data-tt-code=""
      className="overflow-x-auto bg-white p-3 text-[12px] leading-5 text-stone-800"
    >
      <code
        className={`hljs language-${resolved}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  )
}

const DiffPreview = ({ code }: { code: string }) => {
  const lines = code.split('\n')

  return (
    <pre
      data-tt-code=""
      className="overflow-x-auto bg-white p-0 text-[12px] leading-5 text-stone-800"
    >
      <code className="block">
        {lines.map((line, index) => {
          const kind = classifyDiffLine(line)
          const className =
            kind === 'add'
              ? 'block bg-green-50 text-green-900'
              : kind === 'del'
                ? 'block bg-red-50 text-red-900'
                : kind === 'meta'
                  ? 'block bg-stone-100 text-stone-600'
                  : kind === 'hunk'
                    ? 'block bg-blue-50 text-blue-700'
                    : 'block text-stone-700'
          return (
            <span key={index} className={`${className} px-3`}>
              {line.length === 0 ? ' ' : line}
              {'\n'}
            </span>
          )
        })}
      </code>
    </pre>
  )
}

type DiffLineKind = 'add' | 'del' | 'meta' | 'hunk' | 'context'

const classifyDiffLine = (line: string): DiffLineKind => {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
    return 'meta'
  }
  if (line.startsWith('@@')) {
    return 'hunk'
  }
  if (line.startsWith('+')) {
    return 'add'
  }
  if (line.startsWith('-')) {
    return 'del'
  }
  return 'context'
}

const tryFormatJson = (code: string): string | null => {
  const trimmed = code.trim()
  if (trimmed.length === 0) {
    return null
  }
  try {
    const value: unknown = JSON.parse(trimmed)
    return JSON.stringify(value, null, 2)
  } catch {
    return null
  }
}

const JsonPreview = ({ code }: { code: string }) => {
  const formatted = useMemo(() => tryFormatJson(code), [code])
  const [pretty, setPretty] = useState(false)
  const display = pretty && formatted ? formatted : code

  return (
    <div className="flex flex-col">
      {formatted ? (
        <div className="flex items-center gap-1 border-b border-stone-200 bg-white px-3 py-1">
          <button
            type="button"
            onClick={() => setPretty((value) => !value)}
            aria-pressed={pretty}
            className="text-[11px] font-medium text-stone-500 hover:text-stone-700"
          >
            {pretty ? 'Compact' : 'Format'}
          </button>
        </div>
      ) : null}
      <HighlightedCode code={display} language="json" />
    </div>
  )
}

const SimpleHighlighted = ({ code, language }: { code: string; language: string }) => (
  <HighlightedCode code={code} language={language} />
)

const CodeNodeRenderer = ({ node }: ContentNodeRendererProps<CodeBlockNode>) => {
  const language = node.language ?? ''
  const kind = classifyLanguage(language)
  const label = labelForLanguage(language)

  const preview = (() => {
    if (kind === 'diff') {
      return <DiffPreview code={node.code} />
    }
    if (kind === 'json') {
      return <JsonPreview code={node.code} />
    }
    if (kind === 'yaml' || kind === 'http' || kind === 'sql' || kind === 'bash') {
      return <SimpleHighlighted code={node.code} language={kind} />
    }
    return <SimpleHighlighted code={node.code} language={language} />
  })()

  const codeLanguageProp = language ? { codeLanguage: language } : {}

  return (
    <PreviewCodeFrame
      containerProps={{ 'data-tt-code-block': '' }}
      headerStart={
        <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
          {label}
        </span>
      }
      code={node.code}
      {...codeLanguageProp}
      preview={preview}
    />
  )
}

export { CodeNodeRenderer }

export const createCodePlugin = (): ReactNodeRendererPlugin<'codeBlock'> => ({
  id: 'code',
  nodeType: 'codeBlock',
  priority: 30,
  requirements: { lazy: true, clientOnly: true },
  matches: (node) => typeof node.language === 'string' && node.language.length > 0,
  load: () =>
    loadHighlighter()
      .then(() => undefined)
      .catch(() => undefined),
  render: (node) => <CodeNodeRenderer node={node} />
})

export const codePlugin: ReactNodeRendererPlugin<'codeBlock'> = createCodePlugin()
