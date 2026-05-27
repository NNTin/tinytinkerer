type HighlighterApi = {
  highlight: (code: string, language: string) => string
  isSupported: (language: string) => boolean
}

let highlighterPromise: Promise<HighlighterApi> | null = null
let highlighterInstance: HighlighterApi | null = null

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const fallbackHighlight = (code: string): string => escapeHtml(code)

export const loadHighlighter = (): Promise<HighlighterApi> => {
  if (highlighterInstance) {
    return Promise.resolve(highlighterInstance)
  }
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      try {
        const hljsModule = (await import('highlight.js/lib/core')) as {
          default: HljsCore
        }
        const hljs = hljsModule.default
        const languageModules: ReadonlyArray<readonly [string, string]> = [
          ['json', 'json'],
          ['yaml', 'yaml'],
          ['sql', 'sql'],
          ['bash', 'bash'],
          ['shell', 'shell'],
          ['http', 'http'],
          ['typescript', 'typescript'],
          ['javascript', 'javascript'],
          ['python', 'python'],
          ['css', 'css'],
          ['xml', 'xml'],
          ['markdown', 'markdown']
        ]
        for (const [name, module] of languageModules) {
          try {
            const imported = (await import(
              /* @vite-ignore */ `highlight.js/lib/languages/${module}`
            )) as { default: HljsLanguageDefinition }
            hljs.registerLanguage(name, imported.default)
          } catch {
            // Language module missing; skip and let it fall back to plain.
          }
        }
        const api: HighlighterApi = {
          highlight: (code, language) => {
            if (!hljs.getLanguage(language)) {
              return fallbackHighlight(code)
            }
            try {
              return hljs.highlight(code, { language, ignoreIllegals: true }).value
            } catch {
              return fallbackHighlight(code)
            }
          },
          isSupported: (language) => Boolean(hljs.getLanguage(language))
        }
        highlighterInstance = api
        return api
      } catch (error) {
        highlighterPromise = null
        throw error
      }
    })()
  }
  return highlighterPromise
}

export const getHighlighter = (): HighlighterApi | null => highlighterInstance

export const renderHighlighted = (code: string, language: string): string => {
  const instance = highlighterInstance
  if (!instance) {
    return fallbackHighlight(code)
  }
  return instance.highlight(code, language)
}

export const resetHighlighterState = (): void => {
  highlighterPromise = null
  highlighterInstance = null
}

export const escapeCodeHtml = escapeHtml

type HljsLanguageDefinition = unknown

type HljsCore = {
  registerLanguage: (name: string, definition: HljsLanguageDefinition) => void
  getLanguage: (name: string) => unknown
  highlight: (
    code: string,
    options: { language: string; ignoreIllegals?: boolean }
  ) => { value: string }
}

export const HLJS_INLINE_CSS = `
[data-tt-code] .hljs { background: transparent; color: rgb(28 25 23); }
[data-tt-code] .hljs-comment,
[data-tt-code] .hljs-quote { color: rgb(120 113 108); font-style: italic; }
[data-tt-code] .hljs-keyword,
[data-tt-code] .hljs-selector-tag,
[data-tt-code] .hljs-built_in,
[data-tt-code] .hljs-name,
[data-tt-code] .hljs-tag { color: rgb(190 18 60); }
[data-tt-code] .hljs-string,
[data-tt-code] .hljs-doctag,
[data-tt-code] .hljs-attr { color: rgb(21 128 61); }
[data-tt-code] .hljs-number,
[data-tt-code] .hljs-literal { color: rgb(180 83 9); }
[data-tt-code] .hljs-title,
[data-tt-code] .hljs-section,
[data-tt-code] .hljs-class .hljs-title,
[data-tt-code] .hljs-function .hljs-title { color: rgb(29 78 216); }
[data-tt-code] .hljs-attribute { color: rgb(120 53 15); }
[data-tt-code] .hljs-meta { color: rgb(100 116 139); }
[data-tt-code] .hljs-deletion { background: rgba(220 38 38 / 0.1); }
[data-tt-code] .hljs-addition { background: rgba(34 197 94 / 0.1); }
`
