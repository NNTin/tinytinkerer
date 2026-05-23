import { create } from 'zustand'
import { getPreference, setPreference } from '../services/db.js'

const DEFAULT_MODEL = 'openai/gpt-4.1-mini'

const KEYS = {
  selectedModel: 'settings_selected_model',
  searchEnabled: 'settings_search_enabled',
  showThinkingTimeline: 'settings_show_thinking_timeline',
  showToolActivity: 'settings_show_tool_activity'
} as const

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

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback
  return value !== 'false'
}

export const useSettingsStore = create<SettingsState>((set) => ({
  hydrated: false,
  selectedModel: DEFAULT_MODEL,
  searchEnabled: true,
  showThinkingTimeline: true,
  showToolActivity: true,

  initialize: async () => {
    const [selectedModel, searchEnabled, showThinkingTimeline, showToolActivity] = await Promise.all([
      getPreference(KEYS.selectedModel),
      getPreference(KEYS.searchEnabled),
      getPreference(KEYS.showThinkingTimeline),
      getPreference(KEYS.showToolActivity)
    ])
    set({
      hydrated: true,
      selectedModel: selectedModel ?? DEFAULT_MODEL,
      searchEnabled: parseBool(searchEnabled, true),
      showThinkingTimeline: parseBool(showThinkingTimeline, true),
      showToolActivity: parseBool(showToolActivity, true)
    })
  },

  setSelectedModel: async (model) => {
    await setPreference(KEYS.selectedModel, model)
    set({ selectedModel: model })
  },

  setSearchEnabled: async (enabled) => {
    await setPreference(KEYS.searchEnabled, String(enabled))
    set({ searchEnabled: enabled })
  },

  setShowThinkingTimeline: async (show) => {
    await setPreference(KEYS.showThinkingTimeline, String(show))
    set({ showThinkingTimeline: show })
  },

  setShowToolActivity: async (show) => {
    await setPreference(KEYS.showToolActivity, String(show))
    set({ showToolActivity: show })
  }
}))
