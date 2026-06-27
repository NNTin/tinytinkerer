const NONCE_PARAM = 'app-bridge-nonce'

export const readSessionNonce = (hash: string): string | null => {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get(NONCE_PARAM)
  return value && value.trim().length > 0 ? value : null
}
