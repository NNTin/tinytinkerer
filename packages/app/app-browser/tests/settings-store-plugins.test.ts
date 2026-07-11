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

describe('settings-store plugin tool selection (issue #400)', () => {
  it('persists a narrowed tool denylist without touching plugin activation', async () => {
    const store = createSettingsStore(makeShell(preferences))
    await store.getState().setPluginEnabled('multi-tool', true)

    await store
      .getState()
      .setPluginToolSelection({ id: 'multi-tool', toolIds: ['a', 'b', 'c'] }, ['b'])

    expect(store.getState().pluginDisabledTools).toEqual({ 'multi-tool': ['b'] })
    expect(preferences.store.get('settings_plugins_disabled_tools')).toBe(
      JSON.stringify({ 'multi-tool': ['b'] })
    )
    // Activation is untouched by a partial selection.
    expect(store.getState().pluginActivation).toEqual({ 'multi-tool': true })
  })

  it('disabling every tool of a plugin flips its activation off and clears the entry', async () => {
    const store = createSettingsStore(makeShell(preferences))
    await store.getState().setPluginEnabled('multi-tool', true)
    await store.getState().setPluginToolSelection({ id: 'multi-tool', toolIds: ['a', 'b'] }, ['a'])

    await store
      .getState()
      .setPluginToolSelection({ id: 'multi-tool', toolIds: ['a', 'b'] }, ['a', 'b'])

    expect(store.getState().pluginDisabledTools).toEqual({})
    expect(store.getState().pluginActivation).toEqual({ 'multi-tool': false })
    expect(preferences.store.get('settings_plugins_activation')).toBe(
      JSON.stringify({ 'multi-tool': false })
    )
  })

  it('re-enabling all tools deletes the denylist entry', async () => {
    const store = createSettingsStore(makeShell(preferences))
    await store.getState().setPluginToolSelection({ id: 'multi-tool', toolIds: ['a', 'b'] }, ['a'])
    expect(store.getState().pluginDisabledTools).toEqual({ 'multi-tool': ['a'] })

    await store.getState().setPluginToolSelection({ id: 'multi-tool', toolIds: ['a', 'b'] }, [])
    expect(store.getState().pluginDisabledTools).toEqual({})
  })

  // F4 (issue #400 review): the two keys encode ONE user decision ("turn this
  // plugin off"). Persisting activation first means a lost second write leaves
  // the plugin OFF with a stale denylist entry (harmless — GC'd by the next
  // reconciliation sweep) rather than the old order's failure mode, where a lost
  // activation write left the plugin fully re-armed with every tool enabled.
  it('persists activation BEFORE the denylist when a selection disables every tool', async () => {
    const store = createSettingsStore(makeShell(preferences))
    await store.getState().setPluginEnabled('multi-tool', true)

    const setOrder: string[] = []
    const rawSet = preferences.set.bind(preferences)
    preferences.set = (key: string, value: string) => {
      setOrder.push(key)
      return rawSet(key, value)
    }

    await store
      .getState()
      .setPluginToolSelection({ id: 'multi-tool', toolIds: ['a', 'b'] }, ['a', 'b'])

    const activationIndex = setOrder.indexOf('settings_plugins_activation')
    const disabledIndex = setOrder.indexOf('settings_plugins_disabled_tools')
    expect(activationIndex).toBeGreaterThanOrEqual(0)
    expect(disabledIndex).toBeGreaterThanOrEqual(0)
    expect(activationIndex).toBeLessThan(disabledIndex)
  })
})

describe('settings-store reconcilePluginTools (issue #400 review, F2/F3)', () => {
  it('does nothing when no stored entry needs healing', async () => {
    const store = createSettingsStore(makeShell(preferences))
    await store.getState().setPluginEnabled('multi-tool', true)
    await store.getState().setPluginToolSelection({ id: 'multi-tool', toolIds: ['a', 'b'] }, ['a'])
    const disabledToolsWrites = () => preferences.store.get('settings_plugins_disabled_tools')
    const before = disabledToolsWrites()

    await store.getState().reconcilePluginTools([{ id: 'multi-tool', toolIds: ['a', 'b'] }])

    expect(disabledToolsWrites()).toBe(before)
    expect(store.getState().pluginDisabledTools).toEqual({ 'multi-tool': ['a'] })
  })

  it('heals a stored entry that now covers every current tool (plugin update removed a tool)', async () => {
    // Seed the ghost state directly on the preferences store — normal writes
    // can NEVER produce it (the chokepoint prevents it on every write), it only
    // arises from a plugin update landing between sessions: the plugin was left
    // active with a denylist entry ['a'] from when it still had tools ['a','b'];
    // the update since removed 'b', so ['a'] now covers every CURRENT tool.
    preferences.store.set('settings_plugins_activation', JSON.stringify({ 'multi-tool': true }))
    preferences.store.set(
      'settings_plugins_disabled_tools',
      JSON.stringify({ 'multi-tool': ['a'] })
    )
    const store = createSettingsStore(makeShell(preferences))
    await store.getState().initialize()

    await store.getState().reconcilePluginTools([{ id: 'multi-tool', toolIds: ['a'] }])

    expect(store.getState().pluginDisabledTools).toEqual({})
    expect(store.getState().pluginActivation).toEqual({ 'multi-tool': false })
    expect(preferences.store.get('settings_plugins_activation')).toBe(
      JSON.stringify({ 'multi-tool': false })
    )
  })

  it('persists activation before the denylist when reconciliation changes something', async () => {
    preferences.store.set('settings_plugins_activation', JSON.stringify({ 'multi-tool': true }))
    preferences.store.set(
      'settings_plugins_disabled_tools',
      JSON.stringify({ 'multi-tool': ['a'] })
    )
    const store = createSettingsStore(makeShell(preferences))
    await store.getState().initialize()

    const setOrder: string[] = []
    const rawSet = preferences.set.bind(preferences)
    preferences.set = (key: string, value: string) => {
      setOrder.push(key)
      return rawSet(key, value)
    }

    // The plugin's tools shrink to just ['a'] — the stored ['a'] entry now
    // covers everything current, so reconciliation flips activation off.
    await store.getState().reconcilePluginTools([{ id: 'multi-tool', toolIds: ['a'] }])

    const activationIndex = setOrder.indexOf('settings_plugins_activation')
    const disabledIndex = setOrder.indexOf('settings_plugins_disabled_tools')
    expect(activationIndex).toBeGreaterThanOrEqual(0)
    expect(disabledIndex).toBeGreaterThanOrEqual(0)
    expect(activationIndex).toBeLessThan(disabledIndex)
  })

  it('leaves an entry for an undiscovered plugin untouched', async () => {
    const store = createSettingsStore(makeShell(preferences))
    await store.getState().setPluginEnabled('gone-plugin', true)
    await store.getState().setPluginToolSelection({ id: 'gone-plugin', toolIds: ['x', 'y'] }, ['x'])

    // 'gone-plugin' is not in the discovered list this session.
    await store.getState().reconcilePluginTools([{ id: 'other-plugin', toolIds: ['z'] }])

    expect(store.getState().pluginDisabledTools).toEqual({ 'gone-plugin': ['x'] })
    expect(store.getState().pluginActivation).toEqual({ 'gone-plugin': true })
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
