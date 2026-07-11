import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from '@tinytinkerer/app-core'
import { createSettingsStore } from '../src/stores/settings-store.js'
import type { BrowserShell } from '../src/shell.js'
import { applyKonamiPreset } from '../src/konami/apply-konami-preset.js'
import { KONAMI_PRESET } from '../src/konami/konami-config.js'

// setTelemetryEnabled (part of the preset) calls out to the telemetry module to
// arm/disarm Sentry consent. Mocked so this test exercises only the settings
// store + persistence, without booting the real Sentry SDK — same pattern as
// tests/content-render-reporter.test.ts.
const setTelemetryConsent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../src/telemetry/telemetry.js', () => ({
  setTelemetryConsent
}))

// Copied from tests/settings-store-mcp.test.ts: a minimal fake PreferencesStore
// backed by a Map, and a minimal fake BrowserShell wrapping it.
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

const KONAMI_PLUGIN_IDS = [
  'choice-prompt',
  'code-exec',
  'context-inspector',
  'context-usage',
  'event-logger',
  'web-search'
]

let preferences: ReturnType<typeof makePreferences>

beforeEach(() => {
  preferences = makePreferences()
  setTelemetryConsent.mockClear()
})

describe('applyKonamiPreset', () => {
  it('has exactly 9 entries', () => {
    expect(KONAMI_PRESET).toHaveLength(9)
  })

  it('flips all three core settings on and enables all six plugins', async () => {
    const store = createSettingsStore(makeShell(preferences))

    await applyKonamiPreset(store)

    const state = store.getState()
    expect(state.showReasoningActivity).toBe(true)
    expect(state.webSpeechEnabled).toBe(true)
    expect(state.telemetryEnabled).toBe(true)
    for (const pluginId of KONAMI_PLUGIN_IDS) {
      expect(state.pluginActivation[pluginId]).toBe(true)
    }
  })

  it('persists every change to preferences', async () => {
    const store = createSettingsStore(makeShell(preferences))

    await applyKonamiPreset(store)

    expect(await preferences.get('settings_show_reasoning_activity')).toBe('true')
    expect(await preferences.get('settings_web_speech_enabled')).toBe('true')
    expect(await preferences.get('settings_telemetry_enabled')).toBe('true')

    const rawActivation = await preferences.get('settings_plugins_activation')
    expect(rawActivation).toBeDefined()
    const activation = JSON.parse(rawActivation!) as Record<string, boolean>
    for (const pluginId of KONAMI_PLUGIN_IDS) {
      expect(activation[pluginId]).toBe(true)
    }
  })

  it('grants telemetry consent through the same path the modal uses', async () => {
    const store = createSettingsStore(makeShell(preferences))

    await applyKonamiPreset(store)

    expect(setTelemetryConsent).toHaveBeenCalledWith(true)
  })
})
