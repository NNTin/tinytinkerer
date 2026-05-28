import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from 'react'
import {
  useContentRenderOptions,
  useCopyButtonState,
  type CodeBlockNode,
  type ReactNodeRendererPlugin,
  type RenderContext
} from '@tinytinkerer/content-react'
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { StreamLanguage } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { sql } from '@codemirror/lang-sql'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { http } from '@codemirror/legacy-modes/mode/http'
import { diff } from '@codemirror/legacy-modes/mode/diff'

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  yml: 'yaml',
  jsonc: 'json',
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  md: 'markdown',
  patch: 'diff'
}

const resolveLanguageKey = (language: string | undefined): string => {
  if (!language) return ''
  const lower = language.trim().toLowerCase()
  return LANGUAGE_ALIASES[lower] ?? lower
}

const resolveLanguageExtension = (language: string | undefined): Extension => {
  const key = resolveLanguageKey(language)
  switch (key) {
    case 'json':
      return json()
    case 'yaml':
      return yaml()
    case 'sql':
      return sql()
    case 'javascript':
      return javascript()
    case 'typescript':
      return javascript({ typescript: true })
    case 'html':
      return html()
    case 'xml':
      return xml()
    case 'markdown':
      return markdown()
    case 'python':
      return python()
    case 'bash':
      return StreamLanguage.define(shell)
    case 'http':
      return StreamLanguage.define(http)
    case 'diff':
      return StreamLanguage.define(diff)
    default:
      return []
  }
}

const labelForLanguage = (language: string | undefined): string => {
  if (!language) return 'Code'
  const trimmed = language.trim()
  if (trimmed.length === 0) return 'Code'
  return trimmed.toUpperCase()
}

const PERSISTENCE_KEY_PREFIX = 'tt-code-edit:v1'
const PERSISTENCE_DEBOUNCE_MS = 250

const persistenceKey = (scopeId: string, nodeId: string): string =>
  `${PERSISTENCE_KEY_PREFIX}:${scopeId}:${nodeId}`

type EditorRef = RefObject<HTMLDivElement | null>

type UseEditorArgs = {
  value: string
  onChange: (next: string) => void
  language: string | undefined
  editable: boolean
}

const useCodeMirrorEditor = ({
  value,
  onChange,
  language,
  editable
}: UseEditorArgs): EditorRef => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const langCompartmentRef = useRef<Compartment | null>(null)
  const editableCompartmentRef = useRef<Compartment | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const parent = containerRef.current
    if (!parent) {
      return
    }
    const langCompartment = new Compartment()
    const editableCompartment = new Compartment()
    langCompartmentRef.current = langCompartment
    editableCompartmentRef.current = editableCompartment
    const initialLanguage = resolveLanguageExtension(language)
    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        basicSetup,
        keymap.of([...defaultKeymap, indentWithTab]),
        langCompartment.of(initialLanguage),
        editableCompartment.of(EditorView.editable.of(editable)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const doc = update.state.doc.toString()
          if (doc === valueRef.current) return
          valueRef.current = doc
          onChangeRef.current(doc)
        }),
        EditorView.theme({
          '&': { backgroundColor: '#ffffff' },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' }
        })
      ]
    })
    const view = new EditorView({ state, parent })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
      langCompartmentRef.current = null
      editableCompartmentRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value }
    })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    const compartment = langCompartmentRef.current
    if (!view || !compartment) return
    view.dispatch({
      effects: compartment.reconfigure(resolveLanguageExtension(language))
    })
  }, [language])

  useEffect(() => {
    const view = viewRef.current
    const compartment = editableCompartmentRef.current
    if (!view || !compartment) return
    view.dispatch({
      effects: compartment.reconfigure(EditorView.editable.of(editable))
    })
  }, [editable])

  return containerRef
}

const useBodyScrollLock = (active: boolean): void => {
  useEffect(() => {
    if (!active) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [active])
}

type CodeBlockFrameProps = {
  node: CodeBlockNode
  isStreaming: boolean
}

const CodeBlockFrame = ({ node, isStreaming }: CodeBlockFrameProps) => {
  const { codeBlockPersistenceScopeId, showCodeBlockFullscreenButton } = useContentRenderOptions()

  const storageKey = useMemo<string | null>(() => {
    if (!codeBlockPersistenceScopeId || !node.id || isStreaming) return null
    return persistenceKey(codeBlockPersistenceScopeId, node.id)
  }, [codeBlockPersistenceScopeId, node.id, isStreaming])

  const [value, setValue] = useState<string>(() => {
    if (typeof window === 'undefined') return node.code
    if (!isStreaming && codeBlockPersistenceScopeId && node.id) {
      try {
        const stored = window.localStorage.getItem(
          persistenceKey(codeBlockPersistenceScopeId, node.id)
        )
        if (stored !== null) return stored
      } catch {
        // Storage may be disabled; fall through to source.
      }
    }
    return node.code
  })

  // Hydrate from storage when streaming completes mid-mount.
  const hydratedRef = useRef<boolean>(!isStreaming)
  useEffect(() => {
    if (hydratedRef.current) return
    if (isStreaming) return
    hydratedRef.current = true
    if (!storageKey) return
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (stored !== null) {
        setValue((current) => (current === node.code ? stored : current))
      }
    } catch {
      // Ignore storage failures.
    }
  }, [isStreaming, storageKey, node.code])

  // Streaming sync: while streaming, the editor is read-only, so always accept
  // upstream chunks. Once streaming finishes, accept upstream replacements only
  // if the user hasn't edited (current value still matches the prior node.code).
  const prevNodeCodeRef = useRef<string>(node.code)
  useEffect(() => {
    if (node.code === prevNodeCodeRef.current) return
    setValue((current) => {
      if (isStreaming) return node.code
      return current === prevNodeCodeRef.current ? node.code : current
    })
    prevNodeCodeRef.current = node.code
  }, [node.code, isStreaming])

  // Debounced persistence. Refs make the unmount flush use latest values.
  const persistContextRef = useRef({ storageKey, value, nodeCode: node.code })
  persistContextRef.current = { storageKey, value, nodeCode: node.code }

  useEffect(() => {
    if (!storageKey) return
    const timer = window.setTimeout(() => {
      const ctx = persistContextRef.current
      if (!ctx.storageKey) return
      try {
        if (ctx.value === ctx.nodeCode) {
          window.localStorage.removeItem(ctx.storageKey)
        } else {
          window.localStorage.setItem(ctx.storageKey, ctx.value)
        }
      } catch {
        // Ignore storage failures.
      }
    }, PERSISTENCE_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [value, storageKey, node.code])

  useEffect(() => {
    return () => {
      const ctx = persistContextRef.current
      if (!ctx.storageKey) return
      try {
        if (ctx.value === ctx.nodeCode) {
          window.localStorage.removeItem(ctx.storageKey)
        } else {
          window.localStorage.setItem(ctx.storageKey, ctx.value)
        }
      } catch {
        // Ignore storage failures.
      }
    }
  }, [])

  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const closeFullscreen = () => setFullscreenOpen(false)
  const openFullscreen = () => setFullscreenOpen(true)

  const inlineRef = useCodeMirrorEditor({
    value,
    onChange: setValue,
    language: node.language,
    editable: !isStreaming
  })
  const { copied, copy } = useCopyButtonState(value)
  const label = labelForLanguage(node.language)

  return (
    <div
      data-tt-code-block=""
      className="my-3 overflow-hidden rounded-lg border border-stone-200 bg-stone-50"
    >
      <div className="flex items-center justify-between border-b border-stone-200 bg-white px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
          {label}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={copy}
            className="text-[11px] font-medium text-stone-500 hover:text-stone-700 transition-colors px-1.5 py-0.5 rounded"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          {showCodeBlockFullscreenButton ? (
            <button
              type="button"
              onClick={openFullscreen}
              className="text-[11px] font-medium text-stone-500 hover:text-stone-700 transition-colors px-1.5 py-0.5 rounded"
            >
              Fullscreen
            </button>
          ) : null}
        </div>
      </div>
      <div ref={inlineRef} className="tt-code-editor" />
      {fullscreenOpen ? (
        <FullscreenCodeEditor
          value={value}
          language={node.language}
          label={label}
          editable={!isStreaming}
          onChange={setValue}
          onClose={closeFullscreen}
        />
      ) : null}
    </div>
  )
}

type FullscreenCodeEditorProps = {
  value: string
  language: string | undefined
  label: string
  editable: boolean
  onChange: (next: string) => void
  onClose: () => void
}

const FullscreenCodeEditor = ({
  value,
  language,
  label,
  editable,
  onChange,
  onClose
}: FullscreenCodeEditorProps) => {
  useBodyScrollLock(true)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const editorRef = useCodeMirrorEditor({ value, onChange, language, editable })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label} code editor`}
      data-tt-code-fullscreen=""
      className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex flex-1 flex-col overflow-hidden rounded-lg border border-stone-200 bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 bg-white px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
            {label}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-medium text-stone-500 hover:text-stone-700 transition-colors px-1.5 py-0.5 rounded"
          >
            Close
          </button>
        </div>
        <div ref={editorRef} className="tt-code-editor tt-code-editor--fullscreen flex-1 overflow-auto" />
      </div>
    </div>
  )
}

export const createCodePlugin = (): ReactNodeRendererPlugin<'codeBlock'> => ({
  id: 'code',
  nodeType: 'codeBlock',
  priority: 30,
  requirements: { lazy: true, clientOnly: true },
  matches: (node): node is CodeBlockNode => node.type === 'codeBlock',
  render: (node, ctx: RenderContext<unknown>) => (
    <CodeBlockFrame node={node} isStreaming={ctx.isStreaming ?? false} />
  )
})

export const codePlugin: ReactNodeRendererPlugin<'codeBlock'> = createCodePlugin()
