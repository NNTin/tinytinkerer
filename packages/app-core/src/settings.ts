import { DEFAULT_MODEL, normalizeSelectedModel } from './models'
import type { PreferencesStore } from './ports'

export const SETTINGS_KEYS = {
  selectedModel: 'settings_selected_model',
  searchEnabled: 'settings_search_enabled',
  showThinkingTimeline: 'settings_show_thinking_timeline',
  showToolActivity: 'settings_show_tool_activity'
} as const

export type SettingsState = {
  hydrated: boolean
  selectedModel: string
  searchEnabled: boolean
  showThinkingTimeline: boolean
  showToolActivity: boolean
}

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export const defaultSettingsState = (): SettingsState => ({
  hydrated: false,
  selectedModel: DEFAULT_MODEL,
  searchEnabled: true,
  showThinkingTimeline: true,
  showToolActivity: true
})

export const loadSettingsState = async (preferences: PreferencesStore): Promise<SettingsState> => {
  const [selectedModel, searchEnabled, showThinkingTimeline, showToolActivity] = await Promise.all([
    preferences.get(SETTINGS_KEYS.selectedModel),
    preferences.get(SETTINGS_KEYS.searchEnabled),
    preferences.get(SETTINGS_KEYS.showThinkingTimeline),
    preferences.get(SETTINGS_KEYS.showToolActivity)
  ])

  return {
    hydrated: true,
    selectedModel: normalizeSelectedModel(selectedModel),
    searchEnabled: parseBool(searchEnabled, true),
    showThinkingTimeline: parseBool(showThinkingTimeline, true),
    showToolActivity: parseBool(showToolActivity, true)
  }
}

export const persistSelectedModel = async (
  preferences: PreferencesStore,
  model: string
): Promise<string> => {
  const normalizedModel = normalizeSelectedModel(model)
  await preferences.set(SETTINGS_KEYS.selectedModel, normalizedModel)
  return normalizedModel
}

export const persistBooleanPreference = async (
  preferences: PreferencesStore,
  key: string,
  value: boolean
): Promise<boolean> => {
  await preferences.set(key, String(value))
  return value
}
