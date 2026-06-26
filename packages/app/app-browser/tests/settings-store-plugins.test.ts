import { beforeEach, describe, expect, it } from 'vitest'
import { resolvePluginSetting, type PreferencesStore } from '@tinytinkerer/app-core'
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

describe('settings-store plugin activation', () => {
  it('defaults plugin activation to an empty map', () => {
    const store = createSettingsStore(makeShell(preferences))
    expect(store.getState().pluginActivation).toEqual({})
  })

  it('persists and reflects a plugin being enabled then disabled', async () => {
    const store = createSettingsStore(makeShell(preferences))

    await store.getState().setPluginEnabled('send-feedback', true)
    expect(store.getState().pluginActivation).toEqual({ 'send-feedback': true })
    expect(preferences.store.get('settings_plugins_activation')).toBe(
      JSON.stringify({ 'send-feedback': true })
    )

    await store.getState().setPluginEnabled('send-feedback', false)
    expect(store.getState().pluginActivation).toEqual({ 'send-feedback': false })
  })

  it('preserves other plugins when toggling one', async () => {
    const store = createSettingsStore(makeShell(preferences))
    await store.getState().setPluginEnabled('a', true)
    await store.getState().setPluginEnabled('b', true)
    expect(store.getState().pluginActivation).toEqual({ a: true, b: true })
  })
})

describe('settings-store plugin config', () => {
  it('defaults plugin config to an empty map', () => {
    const store = createSettingsStore(makeShell(preferences))
    expect(store.getState().pluginConfig).toEqual({})
  })

  it('persists a per-plugin setting and merges further keys without clobbering', async () => {
    const store = createSettingsStore(makeShell(preferences))

    await store.getState().setPluginSetting('choice-prompt', 'presentation', 'composer')
    expect(store.getState().pluginConfig).toEqual({ 'choice-prompt': { presentation: 'composer' } })
    expect(preferences.store.get('settings_plugins_config')).toBe(
      JSON.stringify({ 'choice-prompt': { presentation: 'composer' } })
    )

    await store.getState().setPluginSetting('choice-prompt', 'compact', true)
    expect(store.getState().pluginConfig).toEqual({
      'choice-prompt': { presentation: 'composer', compact: true }
    })
  })
})

describe('resolvePluginSetting', () => {
  const manifest = {
    id: 'choice-prompt',
    settingsDescriptor: {
      fields: [
        {
          key: 'presentation',
          label: 'Question style',
          type: 'enum' as const,
          options: [
            { value: 'modal', label: 'Pop-up dialog' },
            { value: 'composer', label: 'Docked above the message box' }
          ],
          default: 'modal'
        }
      ]
    }
  }

  it('returns the stored value when present', () => {
    expect(
      resolvePluginSetting(
        { 'choice-prompt': { presentation: 'composer' } },
        manifest,
        'presentation'
      )
    ).toBe('composer')
  })

  it('falls back to the field default when unset', () => {
    expect(resolvePluginSetting({}, manifest, 'presentation')).toBe('modal')
  })

  it('returns undefined for an unknown key with no field', () => {
    expect(resolvePluginSetting({}, manifest, 'nope')).toBeUndefined()
  })
})
