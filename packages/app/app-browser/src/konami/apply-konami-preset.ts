import type { SettingsStore } from '../stores/settings-store'
import { KONAMI_PRESET, type KonamiPresetEntry } from './konami-config'

// Applies KONAMI_PRESET through the SAME store actions the settings modal uses
// (setShowReasoningActivity / setWebSpeechEnabled / setTelemetryEnabled /
// setPluginEnabled), so the cheat code has no persistence path of its own — it
// piggybacks on whatever the modal already does (including telemetry consent
// side effects and preference persistence).
const applyEntry = (settings: SettingsStore, entry: KonamiPresetEntry): Promise<void> => {
  const actions = settings.getState()
  if (entry.kind === 'plugin') {
    return actions.setPluginEnabled(entry.pluginId, entry.enabled)
  }
  // Exhaustive switch on the core setting name: adding a new core setting to
  // KonamiPresetEntry without a case here fails typecheck instead of silently
  // no-oping at runtime.
  switch (entry.setting) {
    case 'showReasoningActivity':
      return actions.setShowReasoningActivity(entry.value)
    case 'webSpeechEnabled':
      return actions.setWebSpeechEnabled(entry.value)
    case 'telemetryEnabled':
      return actions.setTelemetryEnabled(entry.value)
    default: {
      const exhaustive: never = entry.setting
      throw new Error(`Unhandled Konami preset core setting: ${String(exhaustive)}`)
    }
  }
}

export const applyKonamiPreset = async (settings: SettingsStore): Promise<void> => {
  // Sequential is fine — this fires once, on an easter egg, not on a hot path.
  for (const entry of KONAMI_PRESET) {
    await applyEntry(settings, entry)
  }
}
