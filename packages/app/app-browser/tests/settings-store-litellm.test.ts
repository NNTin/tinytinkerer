import { beforeEach, describe, expect, it } from 'vitest'
import type { PreferencesStore } from '@tinytinkerer/app-core'
import { DEFAULT_LITELLM_BASE_URL } from '@tinytinkerer/app-core'
import { createSettingsStore } from '../src/stores/settings-store.js'
import type { BrowserShell } from '../src/shell.js'

const makePreferences = (): PreferencesStore & { store: Map<string, string> } => {
  const store = new Map<string, string>()
  return {
    store,
    get: (key: string) => Promise.resolve(store.get(key)),
    set: (key: string, value: string) => {
      store.set(key, value)
      return Promise.resolve()
    }
  }
}

const makeShell = (preferences: PreferencesStore): BrowserShell =>
  ({
    config: {
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'test',
      authMode: 'hybrid',
      githubClientId: 'test-client',
      hostToken: null
    },
    preferences,
    conversations: {},
    authTokens: {},
    statusGateway: {}
  }) as unknown as BrowserShell

let preferences: ReturnType<typeof makePreferences>

beforeEach(() => {
  preferences = makePreferences()
})

describe('settings-store setLiteLLMBaseUrl', () => {
  it('rejects an invalid base URL with an inline error and does not persist it', async () => {
    const store = createSettingsStore(makeShell(preferences))

    await store.getState().setLiteLLMBaseUrl('http://insecure.example.com/')

    // The input must not silently jump back to the default after Save — the
    // user gets the validation message instead (issue #179).
    expect(store.getState().litellmBaseUrlError).toBe(
      'The base URL must start with https://.'
    )
    expect(store.getState().litellmBaseUrl).toBe(DEFAULT_LITELLM_BASE_URL)
    expect(preferences.store.has('settings_litellm_base_url')).toBe(false)
  })

  it('persists a valid base URL and clears a previous validation error', async () => {
    const store = createSettingsStore(makeShell(preferences))

    await store.getState().setLiteLLMBaseUrl('not a url')
    expect(store.getState().litellmBaseUrlError).toBe(
      'Enter a valid https:// URL.'
    )

    await store.getState().setLiteLLMBaseUrl('https://litellm.example.com/')

    expect(store.getState().litellmBaseUrlError).toBeNull()
    expect(store.getState().litellmBaseUrl).toBe('https://litellm.example.com/')
    expect(preferences.store.get('settings_litellm_base_url')).toBe(
      'https://litellm.example.com/'
    )
  })
})
