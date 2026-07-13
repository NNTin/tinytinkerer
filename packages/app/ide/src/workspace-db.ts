import { createWorkspaceStore } from '@tinytinkerer/app-shell'

export type PersistedIdeWorkspace = {
  id: 'default'
  files: Record<string, string>
  deletedPaths: string[]
  revisions: Record<string, number>
  workspaceRevision: number
  activeFile: string
  visibleFiles: string[]
  updatedAt: string
}

const workspaceStore = createWorkspaceStore<PersistedIdeWorkspace>('tinytinkerer-ide')

export const loadIdeWorkspace = (): Promise<PersistedIdeWorkspace | null> => workspaceStore.load()
export const saveIdeWorkspace = (workspace: PersistedIdeWorkspace): Promise<void> =>
  workspaceStore.save(workspace)
