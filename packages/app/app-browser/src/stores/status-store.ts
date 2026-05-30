import type { SystemStatus } from '@tinytinkerer/contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'
import { fetchStatus as fetchSharedStatus } from '../status'

export const OFFLINE_SYSTEM_STATUS: SystemStatus = {
  auth: { state: 'offline', detail: 'Unavailable' },
  models: { state: 'offline', detail: 'Unavailable' },
  search: { state: 'offline', detail: 'Unavailable' }
}

export type StatusState = {
  hydrated: boolean
  status: SystemStatus
  initialize: () => Promise<void>
  refresh: () => Promise<void>
}

const toOfflineStatus = (error: unknown): SystemStatus => {
  const message = error instanceof Error && error.message ? error.message : 'Unable to reach edge status endpoint'
  return {
    auth: { state: 'offline', detail: 'Unavailable', error: message },
    models: { state: 'offline', detail: 'Unavailable', error: message },
    search: { state: 'offline', detail: 'Unavailable', error: message }
  }
}

export const isSearchReady = (state: Pick<StatusState, 'hydrated' | 'status'>): boolean =>
  state.hydrated && state.status.search.state === 'ready'

export type StatusStore = StoreApi<StatusState>

export const createStatusStore = (shell: BrowserShell): StatusStore =>
  createStore<StatusState>((set) => ({
    hydrated: false,
    status: OFFLINE_SYSTEM_STATUS,
    initialize: async () => {
      try {
        const status = await fetchSharedStatus(shell)
        set({ hydrated: true, status })
      } catch (error) {
        set({ hydrated: true, status: toOfflineStatus(error) })
      }
    },
    refresh: async () => {
      try {
        const status = await fetchSharedStatus(shell)
        set({ hydrated: true, status })
      } catch (error) {
        set({ hydrated: true, status: toOfflineStatus(error) })
      }
    }
  }))
