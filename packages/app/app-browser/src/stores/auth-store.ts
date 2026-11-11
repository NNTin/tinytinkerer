import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'
import { loadCoreModule } from '../core-module'
import { oauthPendingTokenStorageKey } from '../oauth'

export type AuthState = {
  token: string | null
  initialize: () => Promise<void>
  setToken: (token: string) => Promise<void>
  clearToken: () => Promise<void>
}

export type AuthStore = StoreApi<AuthState>

// localStorage throws where storage is disabled (some privacy modes, sandboxed
// frames); no handoff can exist there, so the store carries on without one.
const readPendingToken = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const removePendingToken = (key: string): void => {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to remove where storage is unavailable.
  }
}

export const createAuthStore = (shell: BrowserShell): AuthStore =>
  createStore<AuthState>((set) => ({
    token: null,
    initialize: async () => {
      const { loadAuthState, persistToken } = await loadCoreModule()
      // A sign-in the host completed before this app existed, with the light
      // completeGitHubOAuth from the `/oauth` subpath (issue #518, F3). Moved
      // into this app's own token storage, then deleted; left in place if the
      // write fails, so the next boot tries again.
      const pendingKey = oauthPendingTokenStorageKey(shell.config.storageNamespace)
      const pendingToken = readPendingToken(pendingKey)
      if (pendingToken) {
        await persistToken(shell.authTokens, pendingToken)
        localStorage.removeItem(pendingKey)
      }
      const state = await loadAuthState(shell.authTokens)
      set({ token: state.token })
    },
    setToken: async (token) => {
      const { persistToken } = await loadCoreModule()
      const state = await persistToken(shell.authTokens, token)
      set({ token: state.token })
    },
    clearToken: async () => {
      // Signing out must not be undone by a handoff the next boot would apply.
      removePendingToken(oauthPendingTokenStorageKey(shell.config.storageNamespace))
      const { clearToken } = await loadCoreModule()
      const state = await clearToken(shell.authTokens)
      set({ token: state.token })
    }
  }))
