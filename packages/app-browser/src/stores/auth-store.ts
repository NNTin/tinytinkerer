import { clearToken, loadAuthState, persistToken } from '@tinytinkerer/app-core'
import { create } from 'zustand'
import { getBrowserShell } from '../shell'

type AuthState = {
  token: string | null
  initialize: () => Promise<void>
  setToken: (token: string) => Promise<void>
  clearToken: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  initialize: async () => {
    const state = await loadAuthState(getBrowserShell().authTokens)
    set({ token: state.token })
  },
  setToken: async (token) => {
    const state = await persistToken(getBrowserShell().authTokens, token)
    set({ token: state.token })
  },
  clearToken: async () => {
    const state = await clearToken(getBrowserShell().authTokens)
    set({ token: state.token })
  }
}))
