import { create } from 'zustand'
import { getPreference, setPreference } from '../services/db'

const TOKEN_KEY = 'github_access_token'

type AuthState = {
  token: string | null
  initialize: () => Promise<void>
  setToken: (token: string) => Promise<void>
  clearToken: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  initialize: async () => {
    const value = await getPreference(TOKEN_KEY)
    set({ token: value || null })
  },
  setToken: async (token) => {
    await setPreference(TOKEN_KEY, token)
    set({ token })
  },
  clearToken: async () => {
    await setPreference(TOKEN_KEY, '')
    set({ token: null })
  }
}))
