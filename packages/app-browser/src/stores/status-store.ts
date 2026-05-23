import type { SystemStatus } from '@tinytinkerer/contracts'
import { create } from 'zustand'
import { fetchStatus as fetchSharedStatus } from '../status'

const defaultStatus: SystemStatus = {
  auth: { state: 'offline', detail: 'Unavailable' },
  models: { state: 'offline', detail: 'Unavailable' },
  search: { state: 'offline', detail: 'Unavailable' }
}

type StatusState = {
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

export const useStatusStore = create<StatusState>((set) => ({
  hydrated: false,
  status: defaultStatus,
  initialize: async () => {
    try {
      const status = await fetchSharedStatus()
      set({ hydrated: true, status })
    } catch (error) {
      set({ hydrated: true, status: toOfflineStatus(error) })
    }
  },
  refresh: async () => {
    try {
      const status = await fetchSharedStatus()
      set({ hydrated: true, status })
    } catch (error) {
      set({ hydrated: true, status: toOfflineStatus(error) })
    }
  }
}))
