import Dexie, { type EntityTable } from 'dexie'

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

class IdeDatabase extends Dexie {
  workspaces!: EntityTable<PersistedIdeWorkspace, 'id'>

  constructor() {
    super('tinytinkerer-ide')
    this.version(1).stores({ workspaces: 'id,updatedAt' })
  }
}

let database: IdeDatabase | undefined
const getDatabase = (): IdeDatabase => (database ??= new IdeDatabase())

export const loadIdeWorkspace = async (): Promise<PersistedIdeWorkspace | null> => {
  try {
    return (await getDatabase().workspaces.get('default')) ?? null
  } catch {
    return null
  }
}

export const saveIdeWorkspace = async (workspace: PersistedIdeWorkspace): Promise<void> => {
  await getDatabase().workspaces.put(workspace)
}
