import {
  SandpackCodeEditor,
  SandpackConsole,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
  useSandpackConsole
} from '@codesandbox/sandpack-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ideControllerHandle, type IdeController } from './controller'
import type { ApplyFileChangesInput } from './contracts'
import { loadIdeWorkspace, saveIdeWorkspace, type PersistedIdeWorkspace } from './workspace-db'

type FileSnapshot = Record<string, string>
type HistoryEntry = { files: FileSnapshot; deletedPaths: string[] }

const toCodes = (files: Record<string, { code: string }>): FileSnapshot =>
  Object.fromEntries(Object.entries(files).map(([path, file]) => [path, file.code]))

const countOccurrences = (value: string, search: string): number => value.split(search).length - 1

const displayLog = (value: unknown): string => {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const Workspace = ({ persisted }: { persisted: PersistedIdeWorkspace | null }) => {
  const { sandpack, dispatch } = useSandpack()
  const consoleState = useSandpackConsole({
    showSyntaxError: true,
    maxMessageCount: 200
  })
  const [filter, setFilter] = useState('')
  const [deletedPaths, setDeletedPaths] = useState<Set<string>>(
    () => new Set(persisted?.deletedPaths ?? [])
  )
  const [storageError, setStorageError] = useState('')
  const [narrow, setNarrow] = useState(() => window.innerWidth < 860)

  const stateRef = useRef(sandpack)
  stateRef.current = sandpack
  const logsRef = useRef<unknown[]>(consoleState.logs)
  logsRef.current = consoleState.logs
  const deletedRef = useRef(deletedPaths)
  deletedRef.current = deletedPaths
  const revisionsRef = useRef<Record<string, number>>(persisted?.revisions ?? {})
  const workspaceRevisionRef = useRef(persisted?.workspaceRevision ?? 0)
  const lastCodesRef = useRef<FileSnapshot>(toCodes(sandpack.files))
  const historyRef = useRef<HistoryEntry[]>([])
  const controllerRef = useRef<IdeController | null>(null)

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 860)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Reapply paths deleted from the template after Sandpack expands its built-in
  // react-ts files. Later deletions are handled directly by the controller.
  useEffect(() => {
    for (const path of persisted?.deletedPaths ?? []) sandpack.deleteFile(path)
    // Initial hydration only.
  }, [])

  // User edits made by SandpackCodeEditor flow through Sandpack state. Detect them,
  // issue monotonic file revisions, then let the persistence effect store the result.
  useEffect(() => {
    const current = toCodes(sandpack.files)
    const previous = lastCodesRef.current
    const changed = new Set([...Object.keys(current), ...Object.keys(previous)])
    let anyChanged = false
    for (const path of changed) {
      if (current[path] === previous[path]) continue
      anyChanged = true
      if (current[path] === undefined) delete revisionsRef.current[path]
      else revisionsRef.current[path] = (revisionsRef.current[path] ?? 0) + 1
    }
    if (anyChanged) workspaceRevisionRef.current += 1
    lastCodesRef.current = current
  }, [sandpack.files])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const current = toCodes(sandpack.files)
      void saveIdeWorkspace({
        id: 'default',
        files: current,
        deletedPaths: [...deletedPaths],
        revisions: { ...revisionsRef.current },
        workspaceRevision: workspaceRevisionRef.current,
        activeFile: sandpack.activeFile,
        visibleFiles: [...sandpack.visibleFiles],
        updatedAt: new Date().toISOString()
      }).then(
        () => setStorageError(''),
        () => setStorageError('Changes are only in memory because browser storage is unavailable.')
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [sandpack.files, sandpack.activeFile, sandpack.visibleFiles, deletedPaths])

  const controller = useMemo<IdeController>(() => {
    const currentCodes = () => toCodes(stateRef.current.files)
    const installSnapshot = (files: FileSnapshot, deleted: Set<string>) => {
      const current = currentCodes()
      const toDelete = Object.keys(current).filter((path) => !(path in files))
      lastCodesRef.current = { ...files }
      stateRef.current.updateFile(
        Object.fromEntries(Object.entries(files).map(([path, code]) => [path, { code }]))
      )
      for (const path of toDelete) stateRef.current.deleteFile(path)
      setDeletedPaths(new Set(deleted))
    }

    const value: IdeController = {
      inspectWorkspace() {
        const files = currentCodes()
        return {
          workspaceId: 'default',
          workspaceRevision: workspaceRevisionRef.current,
          activeFile: stateRef.current.activeFile,
          openFiles: stateRef.current.visibleFiles,
          files: Object.keys(files)
            .sort()
            .map((path) => ({
              path,
              revision: revisionsRef.current[path] ?? 0,
              bytes: new TextEncoder().encode(files[path] ?? '').byteLength
            })),
          runtime: { status: stateRef.current.status, error: stateRef.current.error ?? null }
        }
      },
      searchFiles({ query, maxResults }) {
        const needle = query.toLocaleLowerCase()
        const results: Array<{ path: string; line?: number; preview?: string }> = []
        for (const [path, content] of Object.entries(currentCodes()).sort()) {
          if (path.toLocaleLowerCase().includes(needle)) results.push({ path })
          const lines = content.split('\n')
          for (let line = 0; line < lines.length && results.length < maxResults; line += 1) {
            const candidate = lines[line]
            if (candidate?.toLocaleLowerCase().includes(needle)) {
              results.push({ path, line: line + 1, preview: candidate.trim().slice(0, 240) })
            }
          }
          if (results.length >= maxResults) break
        }
        return {
          query,
          results: results.slice(0, maxResults),
          truncated: results.length >= maxResults
        }
      },
      readFiles({ paths }) {
        const files = currentCodes()
        return {
          files: paths.map((path) => {
            if (!(path in files)) throw new Error(`File does not exist: ${path}`)
            return { path, content: files[path], revision: revisionsRef.current[path] ?? 0 }
          })
        }
      },
      applyFileChanges({ changes }: ApplyFileChangesInput) {
        const before = currentCodes()
        const next = { ...before }
        const nextDeleted = new Set(deletedRef.current)
        const touched = new Set<string>()

        for (const change of changes) {
          const actualRevision = revisionsRef.current[change.path]
          if (change.kind === 'create') {
            if (change.path in next) throw new Error(`File already exists: ${change.path}`)
            next[change.path] = change.content
            nextDeleted.delete(change.path)
            touched.add(change.path)
            continue
          }
          if (!(change.path in next)) throw new Error(`File does not exist: ${change.path}`)
          if (actualRevision !== change.expectedRevision) {
            throw new Error(
              `Revision conflict for ${change.path}: expected ${change.expectedRevision}, received ${actualRevision ?? 0}`
            )
          }
          if (change.kind === 'replace') {
            next[change.path] = change.content
            touched.add(change.path)
          } else if (change.kind === 'edit') {
            const occurrences = countOccurrences(next[change.path] ?? '', change.oldText)
            if (occurrences === 0) throw new Error(`Text was not found in ${change.path}`)
            if (occurrences > 1 && !change.replaceAll) {
              throw new Error(
                `Text is ambiguous in ${change.path}; set replaceAll to edit every match`
              )
            }
            next[change.path] = change.replaceAll
              ? (next[change.path] ?? '').split(change.oldText).join(change.newText)
              : (next[change.path] ?? '').replace(change.oldText, change.newText)
            touched.add(change.path)
          } else if (change.kind === 'move') {
            if (change.destination in next) {
              throw new Error(`Destination already exists: ${change.destination}`)
            }
            next[change.destination] = next[change.path] ?? ''
            delete next[change.path]
            nextDeleted.add(change.path)
            nextDeleted.delete(change.destination)
            touched.add(change.path)
            touched.add(change.destination)
          } else {
            delete next[change.path]
            nextDeleted.add(change.path)
            touched.add(change.path)
          }
        }

        historyRef.current.push({ files: before, deletedPaths: [...deletedRef.current] })
        if (historyRef.current.length > 20) historyRef.current.shift()
        workspaceRevisionRef.current += 1
        const nextRevisions = { ...revisionsRef.current }
        for (const path of touched) {
          if (path in next) nextRevisions[path] = (nextRevisions[path] ?? 0) + 1
          else delete nextRevisions[path]
        }
        revisionsRef.current = nextRevisions
        installSnapshot(next, nextDeleted)
        return Promise.resolve({
          workspaceRevision: workspaceRevisionRef.current,
          changes: [...touched].map((path) => ({
            path,
            deleted: !(path in next),
            revision: nextRevisions[path]
          }))
        })
      },
      inspectRuntime({ maxLogs }) {
        return {
          status: stateRef.current.status,
          error: stateRef.current.error ?? null,
          logs: logsRef.current.slice(-maxLogs).map(displayLog)
        }
      },
      restartRuntime() {
        dispatch({ type: 'refresh' })
        return Promise.resolve({ restarted: true })
      },
      undoLastChange() {
        const previous = historyRef.current.pop()
        if (!previous) return Promise.resolve(false)
        const current = currentCodes()
        workspaceRevisionRef.current += 1
        const paths = new Set([...Object.keys(current), ...Object.keys(previous.files)])
        for (const path of paths) {
          if (path in previous.files) {
            revisionsRef.current[path] = (revisionsRef.current[path] ?? 0) + 1
          } else {
            delete revisionsRef.current[path]
          }
        }
        installSnapshot(previous.files, new Set(previous.deletedPaths))
        return Promise.resolve(true)
      }
    }
    return value
  }, [dispatch])
  controllerRef.current = controller

  useEffect(() => {
    ideControllerHandle.setController(controller)
    return () => ideControllerHandle.setController(null)
  }, [controller])

  const files = Object.keys(sandpack.files)
    .filter((path) => path.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
    .sort()

  const createFile = () => {
    const raw = window.prompt('New file path', '/src/new-file.ts')
    if (!raw) return
    const path = raw.startsWith('/') ? raw : `/${raw}`
    if (sandpack.files[path]) return window.alert(`File already exists: ${path}`)
    sandpack.addFile(path, '')
    sandpack.openFile(path)
    setDeletedPaths((current) => {
      const next = new Set(current)
      next.delete(path)
      return next
    })
  }

  const renameActive = () => {
    const path = sandpack.activeFile
    const destination = window.prompt('Rename file', path)
    if (!destination || destination === path) return
    void controller.applyFileChanges({
      changes: [
        {
          kind: 'move',
          path,
          destination: destination.startsWith('/') ? destination : `/${destination}`,
          expectedRevision: revisionsRef.current[path] ?? 0
        }
      ]
    })
  }

  const deleteActive = () => {
    const path = sandpack.activeFile
    if (!window.confirm(`Delete ${path}?`)) return
    void controller.applyFileChanges({
      changes: [{ kind: 'delete', path, expectedRevision: revisionsRef.current[path] ?? 0 }]
    })
  }

  if (narrow) {
    return (
      <main className="ide-narrow" aria-label="TinyTinkerer IDE">
        <strong>A wider viewport is required</strong>
        <p>The browser IDE currently supports desktop and tablet layouts.</p>
      </main>
    )
  }

  return (
    <main className="ide-root" aria-label="TinyTinkerer IDE">
      <header className="ide-header">
        <strong>TinyTinkerer IDE</strong>
        <div className="ide-header-actions">
          {storageError ? <span className="ide-storage-error">{storageError}</span> : null}
          <button type="button" onClick={() => void controllerRef.current?.undoLastChange()}>
            Undo agent change
          </button>
          <span>Browser-first · IndexedDB only</span>
        </div>
      </header>
      <div className="ide-body">
        <aside className="ide-explorer" aria-label="Explorer">
          <div className="ide-pane-title">
            <strong>Explorer</strong>
            <div>
              <button type="button" title="New file" onClick={createFile}>
                +
              </button>
              <button type="button" title="Rename active file" onClick={renameActive}>
                ↗
              </button>
              <button type="button" title="Delete active file" onClick={deleteActive}>
                −
              </button>
            </div>
          </div>
          <input
            aria-label="Search files"
            placeholder="Search files"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <nav className="ide-file-tree" aria-label="Workspace files">
            {files.map((path) => (
              <button
                type="button"
                key={path}
                className={path === sandpack.activeFile ? 'active' : ''}
                style={{ paddingLeft: `${12 + Math.max(0, path.split('/').length - 2) * 12}px` }}
                onClick={() => sandpack.openFile(path)}
              >
                <span aria-hidden="true">▱</span>
                {path.split('/').at(-1)}
              </button>
            ))}
          </nav>
        </aside>
        <section className="ide-workspace">
          <div className="ide-editor-preview">
            <section className="ide-editor" aria-label="Code editor">
              <SandpackCodeEditor
                showTabs
                closableTabs
                showLineNumbers
                showInlineErrors
                wrapContent={false}
              />
            </section>
            <section className="ide-preview" aria-label="Application preview">
              <SandpackPreview showNavigator showOpenInCodeSandbox={false} showRefreshButton />
            </section>
          </div>
          <section className="ide-output" aria-label="Output console">
            <div className="ide-output-title">
              <span>Console</span>
              <button type="button" onClick={consoleState.reset}>
                Clear
              </button>
            </div>
            <SandpackConsole showHeader={false} showSyntaxError />
          </section>
        </section>
      </div>
    </main>
  )
}

export const IdeStage = (): React.JSX.Element => {
  const [persisted, setPersisted] = useState<PersistedIdeWorkspace | null | undefined>()
  useEffect(() => {
    void loadIdeWorkspace().then(setPersisted)
  }, [])

  if (persisted === undefined) {
    return <div className="ide-loading">Opening browser workspace…</div>
  }

  const files = persisted
    ? Object.fromEntries(Object.entries(persisted.files).map(([path, code]) => [path, { code }]))
    : undefined

  return (
    <SandpackProvider
      template="react-ts"
      style={{ height: '100%' }}
      {...(files ? { files } : {})}
      options={{
        activeFile: persisted?.activeFile ?? '/App.tsx',
        visibleFiles: persisted?.visibleFiles ?? ['/App.tsx', '/index.tsx'],
        autorun: true,
        recompileMode: 'delayed',
        recompileDelay: 300
      }}
      theme="light"
    >
      <Workspace persisted={persisted} />
    </SandpackProvider>
  )
}
