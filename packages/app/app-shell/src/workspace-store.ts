import Dexie from 'dexie'

export type WorkspaceRecord = {
  id: 'default'
  updatedAt: string
}

export type WorkspaceStore<TWorkspace extends WorkspaceRecord> = {
  load(): Promise<TWorkspace | null>
  save(workspace: TWorkspace): Promise<void>
}

// Browser workspace persistence shared by trusted stages. Database creation is
// deferred until first use so importing a stage's controller/tools has no storage
// side effect during shell bootstrap.
export const createWorkspaceStore = <TWorkspace extends WorkspaceRecord>(
  databaseName: string
): WorkspaceStore<TWorkspace> => {
  let database: Dexie | undefined

  const getDatabase = (): Dexie => {
    if (database) return database
    const next = new Dexie(databaseName)
    next.version(1).stores({ workspaces: 'id,updatedAt' })
    database = next
    return next
  }

  return {
    async load() {
      try {
        return (
          (await getDatabase().table<TWorkspace, 'default'>('workspaces').get('default')) ?? null
        )
      } catch {
        return null
      }
    },
    async save(workspace) {
      await getDatabase().table<TWorkspace, 'default'>('workspaces').put(workspace)
    }
  }
}
