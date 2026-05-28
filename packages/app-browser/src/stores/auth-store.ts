import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'
import { loadCoreModule } from '../core-module'

export type AuthState = {
  token: string | null
  initialize: () => Promise<void>
  setToken: (token: string) => Promise<void>
  clearToken: () => Promise<void>
}

export type AuthStore = StoreApi<AuthState>

export const createAuthStore = (shell: BrowserShell): AuthStore =>
  createStore<AuthState>((set) => ({
    token: null,
    initialize: async () => {
      const { loadAuthState } = await loadCoreModule()
      const state = await loadAuthState(shell.authTokens)
      set({ token: state.token })
    },
    setToken: async (token) => {
      const { persistToken } = await loadCoreModule()
      const state = await persistToken(shell.authTokens, token)
      set({ token: state.token })
    },
    clearToken: async () => {
      const { clearToken } = await loadCoreModule()
      const state = await clearToken(shell.authTokens)
      set({ token: state.token })
    }
  }))
