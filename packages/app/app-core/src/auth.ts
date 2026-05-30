import type { AuthTokenStore } from './ports'

export const TOKEN_KEY = 'github_access_token'

export type AuthStateSnapshot = {
  token: string | null
}

export const loadAuthState = async (store: AuthTokenStore): Promise<AuthStateSnapshot> => {
  const hostToken = store.getHostToken?.() ?? null
  if (hostToken) {
    return { token: hostToken }
  }

  return { token: await store.getStoredToken() }
}

export const persistToken = async (
  store: AuthTokenStore,
  token: string
): Promise<AuthStateSnapshot> => {
  await store.setStoredToken(token)
  return loadAuthState(store)
}

export const clearToken = async (store: AuthTokenStore): Promise<AuthStateSnapshot> => {
  await store.clearStoredToken()
  return loadAuthState(store)
}
