import {
  DEFAULT_MODEL,
  SETTINGS_KEYS,
  defaultSettingsState,
  loadSettingsState,
  persistBooleanPreference,
  persistSelectedModel
} from '@tinytinkerer/app-core'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'

export type SettingsState = {
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

export type SettingsStore = StoreApi<SettingsState>

export const createSettingsStore = (shell: BrowserShell): SettingsStore =>
  createStore<SettingsState>((set) => ({
    ...defaultSettingsState(),
    selectedModel: DEFAULT_MODEL,
    initialize: async () => {
      const state = await loadSettingsState(shell.preferences)
      set(state)
    },
    setSelectedModel: async (model) => {
      const normalizedModel = await persistSelectedModel(shell.preferences, model)
      set({ selectedModel: normalizedModel })
    },
    setSearchEnabled: async (enabled) => {
      await persistBooleanPreference(shell.preferences, SETTINGS_KEYS.searchEnabled, enabled)
      set({ searchEnabled: enabled })
    },
    setShowThinkingTimeline: async (show) => {
      await persistBooleanPreference(shell.preferences, SETTINGS_KEYS.showThinkingTimeline, show)
      set({ showThinkingTimeline: show })
    },
    setShowToolActivity: async (show) => {
      await persistBooleanPreference(shell.preferences, SETTINGS_KEYS.showToolActivity, show)
      set({ showToolActivity: show })
    }
  }))
