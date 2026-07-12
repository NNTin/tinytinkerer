import { DockablePanelLayout } from '@tinytinkerer/app-harness'
import { CodeMirrorEditor } from '@tinytinkerer/content-code'
import {
  renderMermaidSource,
  toMermaidDiagnostic,
  validateMermaidSource
} from '@tinytinkerer/content-mermaid'
import {
  applyWorkspaceChanges,
  type ApplyFileChangesInput,
  type FileDiagnostic,
  type ReadFilesInput
} from '@tinytinkerer/file-tools'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { mermaidControllerHandle, type MermaidController } from './controller'
import { buildMermaidFixPrompt } from './fix-prompt'
import { loadMermaidWorkspace, saveMermaidWorkspace } from './workspace-db'
import { MERMAID_FILE_PATH } from './workspace-constants'

const DEFAULT_SOURCE = `flowchart TD
  Idea[New idea] --> Draft[Draft diagram]
  Draft --> Review{Looks right?}
  Review -- Yes --> Share[Share it]
  Review -- No --> Draft`

export type MermaidStageProps = {
  assistant: ReactNode
  onRequestAssistantFix?: (prompt: string) => void | Promise<void>
}

const diagnosticFor = (
  value: Awaited<ReturnType<typeof validateMermaidSource>>
): FileDiagnostic[] | undefined =>
  value ? [{ path: MERMAID_FILE_PATH, severity: 'error', ...value }] : undefined
export const MermaidStage = ({
  assistant,
  onRequestAssistantFix
}: MermaidStageProps): React.JSX.Element => {
  const [loaded, setLoaded] = useState(false)
  const [source, setSource] = useState(DEFAULT_SOURCE)
  const [svg, setSvg] = useState<string | null>(null)
  const [diagnostic, setDiagnostic] = useState<FileDiagnostic | null>(null)
  const [storageError, setStorageError] = useState('')
  const sourceRef = useRef(source)
  sourceRef.current = source
  const revisionRef = useRef(0)
  const workspaceRevisionRef = useRef(0)
  const diagnosticRef = useRef<FileDiagnostic | null>(null)
  diagnosticRef.current = diagnostic

  useEffect(() => {
    void loadMermaidWorkspace().then((stored) => {
      if (stored) {
        setSource(stored.source)
        revisionRef.current = stored.fileRevision
        workspaceRevisionRef.current = stored.workspaceRevision
      }
      setLoaded(true)
    })
  }, [])
  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(
      () =>
        void saveMermaidWorkspace({
          id: 'default',
          source,
          fileRevision: revisionRef.current,
          workspaceRevision: workspaceRevisionRef.current,
          updatedAt: new Date().toISOString()
        }).then(
          () => setStorageError(''),
          () =>
            setStorageError('Changes are only in memory because browser storage is unavailable.')
        ),
      300
    )
    return () => window.clearTimeout(timer)
  }, [loaded, source])
  useEffect(() => {
    if (!loaded) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (source.trim().length === 0) {
        setSvg(null)
        setDiagnostic(null)
        return
      }
      void renderMermaidSource(source, `tt-mermaid-app-${Date.now()}`).then(
        (result) => {
          if (!cancelled) {
            setSvg(result.svg)
            setDiagnostic(null)
          }
        },
        (error) => {
          if (!cancelled)
            setDiagnostic({
              path: MERMAID_FILE_PATH,
              severity: 'error',
              ...toMermaidDiagnostic(error)
            })
        }
      )
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [loaded, source])

  const updateFromUser = (next: string) => {
    if (next === sourceRef.current) return
    revisionRef.current += 1
    workspaceRevisionRef.current += 1
    sourceRef.current = next
    setSource(next)
  }
  const controller = useMemo<MermaidController>(
    () => ({
      readFiles({ paths }: ReadFilesInput) {
        for (const path of paths)
          if (path !== MERMAID_FILE_PATH) throw new Error(`File does not exist: ${path}`)
        return {
          files: [
            { path: MERMAID_FILE_PATH, content: sourceRef.current, revision: revisionRef.current }
          ],
          ...(diagnosticRef.current ? { diagnostics: [diagnosticRef.current] } : {})
        }
      },
      async applyFileChanges(input: ApplyFileChangesInput) {
        if (
          input.changes.some(
            (change) =>
              change.path !== MERMAID_FILE_PATH ||
              (change.kind !== 'replace' && change.kind !== 'edit')
          )
        )
          throw new Error(
            `The Mermaid workspace supports replace/edit changes for ${MERMAID_FILE_PATH} only.`
          )
        const result = applyWorkspaceChanges(
          {
            files: { [MERMAID_FILE_PATH]: sourceRef.current },
            revisions: { [MERMAID_FILE_PATH]: revisionRef.current },
            deletedPaths: new Set()
          },
          input
        )
        const next = result.files[MERMAID_FILE_PATH] ?? ''
        revisionRef.current = result.revisions[MERMAID_FILE_PATH] ?? revisionRef.current
        workspaceRevisionRef.current += 1
        sourceRef.current = next
        setSource(next)
        const currentDiagnostic = await validateMermaidSource(next)
        const diagnostics = diagnosticFor(currentDiagnostic)
        return {
          workspaceRevision: workspaceRevisionRef.current,
          changes: result.touchedPaths.map((path) => ({
            path,
            deleted: false,
            revision: result.revisions[path]
          })),
          ...(diagnostics ? { diagnostics } : {})
        }
      }
    }),
    []
  )
  useEffect(() => {
    mermaidControllerHandle.setController(controller)
    return () => mermaidControllerHandle.setController(null)
  }, [controller])

  if (!loaded) return <div className="mermaid-loading">Opening Mermaid workspace…</div>
  const editor = (
    <div className="mermaid-editor">
      <div className="mermaid-file-bar">
        <code>{MERMAID_FILE_PATH}</code>
        <span>revision {revisionRef.current}</span>
      </div>
      <CodeMirrorEditor
        value={source}
        onChange={updateFromUser}
        language="mermaid"
        ariaLabel="Mermaid source editor"
        className="mermaid-code-mirror"
      />
    </div>
  )
  const preview = (
    <div className="mermaid-preview">
      {storageError ? <p className="mermaid-storage-error">{storageError}</p> : null}
      {diagnostic ? (
        <div className="mermaid-diagnostic" role="alert">
          <strong>
            Mermaid syntax error{diagnostic.line ? ` on line ${diagnostic.line}` : ''}
          </strong>
          <p>{diagnostic.message}</p>
          {onRequestAssistantFix ? (
            <button
              type="button"
              onClick={() =>
                void onRequestAssistantFix(
                  buildMermaidFixPrompt(source, revisionRef.current, diagnostic)
                )
              }
            >
              Ask assistant to fix
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="mermaid-svg" aria-label={svg ? 'Mermaid diagram' : 'Mermaid preview'}>
        {svg ? (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p>{source.trim() ? 'Rendering preview…' : 'Write Mermaid syntax to begin.'}</p>
        )}
      </div>
      {diagnostic && svg ? (
        <span className="mermaid-stale-note">Showing the last valid preview.</span>
      ) : null}
    </div>
  )
  return (
    <main className="mermaid-root" aria-label="TinyTinkerer Mermaid">
      <DockablePanelLayout
        title="Mermaid workspace"
        storageKey="tinytinkerer:mermaid-layout:v1"
        panels={[
          { id: 'editor', title: 'CodeMirror editor', content: editor },
          { id: 'preview', title: 'Preview', content: preview },
          { id: 'assistant', title: 'Assistant chat', content: assistant }
        ]}
      />
    </main>
  )
}
