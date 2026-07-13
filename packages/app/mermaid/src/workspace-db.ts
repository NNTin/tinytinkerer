import { createWorkspaceStore } from '@tinytinkerer/app-shell'

export type PersistedMermaidWorkspace = {
  id: 'default'
  source: string
  fileRevision: number
  workspaceRevision: number
  updatedAt: string
}

const workspaceStore = createWorkspaceStore<PersistedMermaidWorkspace>('tinytinkerer-mermaid')

export const loadMermaidWorkspace = (): Promise<PersistedMermaidWorkspace | null> =>
  workspaceStore.load()
export const saveMermaidWorkspace = (workspace: PersistedMermaidWorkspace): Promise<void> =>
  workspaceStore.save(workspace)
