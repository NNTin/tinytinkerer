import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'

export type AuthState = {
  token: string | null
  initialize: () => Promise<void>
  setToken: (token: string) => Promise<void>
  clearToken: () => Promise<void>
}

export type AuthStore = StoreApi<AuthState>

const loadAuthModule = () => import('@tinytinkerer/app-core')

export const createAuthStore = (shell: BrowserShell): AuthStore =>
  createStore<AuthState>((set) => ({
    token: null,
    initialize: async () => {
      const { loadAuthState } = await loadAuthModule()
      const state = await loadAuthState(shell.authTokens)
      set({ token: state.token })
    },
    setToken: async (token) => {
      const { persistToken } = await loadAuthModule()
      const state = await persistToken(shell.authTokens, token)
      set({ token: state.token })
    },
    clearToken: async () => {
      const { clearToken } = await loadAuthModule()
      const state = await clearToken(shell.authTokens)
      set({ token: state.token })
    }
  }))
