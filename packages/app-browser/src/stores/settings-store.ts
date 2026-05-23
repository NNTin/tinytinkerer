import {
  DEFAULT_MODEL,
  SETTINGS_KEYS,
  defaultSettingsState,
  loadSettingsState,
  persistBooleanPreference,
  persistSelectedModel
} from '@tinytinkerer/app-core'
import { create } from 'zustand'
import { getBrowserShell } from '../shell'

type SettingsState = {
  hydrated: boolean
  selectedModel: string
  searchEnabled: boolean
  showThinkingTimeline: boolean
  showToolActivity: boolean
  initialize: () => Promise<void>
  setSelectedModel: (model: string) => Promise<void>
  setSearchEnabled: (enabled: boolean) => Promise<void>
  setShowThinkingTimeline: (show: boolean) => Promise<void>
  setShowToolActivity: (show: boolean) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...defaultSettingsState(),
  selectedModel: DEFAULT_MODEL,
  initialize: async () => {
    const state = await loadSettingsState(getBrowserShell().preferences)
    set(state)
  },
  setSelectedModel: async (model) => {
    const normalizedModel = await persistSelectedModel(getBrowserShell().preferences, model)
    set({ selectedModel: normalizedModel })
  },
  setSearchEnabled: async (enabled) => {
    await persistBooleanPreference(getBrowserShell().preferences, SETTINGS_KEYS.searchEnabled, enabled)
    set({ searchEnabled: enabled })
  },
  setShowThinkingTimeline: async (show) => {
    await persistBooleanPreference(
      getBrowserShell().preferences,
      SETTINGS_KEYS.showThinkingTimeline,
      show
    )
    set({ showThinkingTimeline: show })
  },
  setShowToolActivity: async (show) => {
    await persistBooleanPreference(getBrowserShell().preferences, SETTINGS_KEYS.showToolActivity, show)
    set({ showToolActivity: show })
  }
}))
