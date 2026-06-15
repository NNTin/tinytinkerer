import type { PreferencesStore } from '@tinytinkerer/app-core'

const INSTALL_ID_KEY = 'telemetry_install_id'

/**
 * Returns the persisted pseudonymous install ID, generating and storing a new
 * random UUID on first access. The ID is scoped to the shell's storage
 * namespace via the underlying {@link PreferencesStore}.
 */
export const getOrCreateInstallId = async (preferences: PreferencesStore): Promise<string> => {
  const existing = await preferences.get(INSTALL_ID_KEY)
  if (existing) {
    return existing
  }

  const installId = crypto.randomUUID()
  await preferences.set(INSTALL_ID_KEY, installId)
  return installId
}
