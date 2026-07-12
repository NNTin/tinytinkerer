import Dexie, { type EntityTable } from 'dexie'

export type PersistedMermaidWorkspace = {
  id: 'default'
  source: string
  fileRevision: number
  workspaceRevision: number
  updatedAt: string
}

class MermaidDatabase extends Dexie {
  workspaces!: EntityTable<PersistedMermaidWorkspace, 'id'>
  constructor() {
    super('tinytinkerer-mermaid')
    this.version(1).stores({ workspaces: 'id,updatedAt' })
  }
}
let database: MermaidDatabase | undefined
const getDatabase = () => (database ??= new MermaidDatabase())
export const loadMermaidWorkspace = async (): Promise<PersistedMermaidWorkspace | null> => {
  try {
    return (await getDatabase().workspaces.get('default')) ?? null
  } catch {
    return null
  }
}
export const saveMermaidWorkspace = async (workspace: PersistedMermaidWorkspace): Promise<void> => {
  await getDatabase().workspaces.put(workspace)
}
