import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetPreference = vi.hoisted(() =>
  vi.fn<(key: string) => Promise<string | undefined>>()
)
const mockSetPreference = vi.hoisted(() =>
  vi.fn<(key: string, value: string) => Promise<void>>()
)

vi.mock('../services/db.js', () => ({
  getPreference: mockGetPreference,
  setPreference: mockSetPreference
}))

import { useSettingsStore } from './settings-store.js'

const DEFAULT_MODEL = 'openai/gpt-4.1-mini'

const resetStore = () => {
  useSettingsStore.setState({
    selectedModel: DEFAULT_MODEL,
    searchEnabled: true,
    showThinkingTimeline: true,
    showToolActivity: true
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetPreference.mockResolvedValue(undefined)
  mockSetPreference.mockResolvedValue(undefined)
  resetStore()
})

describe('settings-store defaults', () => {
  it('has the expected default values before initialize is called', () => {
    const state = useSettingsStore.getState()
    expect(state.selectedModel).toBe(DEFAULT_MODEL)
    expect(state.searchEnabled).toBe(true)
    expect(state.showThinkingTimeline).toBe(true)
    expect(state.showToolActivity).toBe(true)
  })
})

describe('settings-store initialize', () => {
  it('reads all four preference keys from the DB', async () => {
    await useSettingsStore.getState().initialize()
    expect(mockGetPreference).toHaveBeenCalledWith('settings_selected_model')
    expect(mockGetPreference).toHaveBeenCalledWith('settings_search_enabled')
    expect(mockGetPreference).toHaveBeenCalledWith('settings_show_thinking_timeline')
    expect(mockGetPreference).toHaveBeenCalledWith('settings_show_tool_activity')
  })

  it('falls back to defaults when DB returns undefined for all keys', async () => {
    mockGetPreference.mockResolvedValue(undefined)
    await useSettingsStore.getState().initialize()
    const state = useSettingsStore.getState()
    expect(state.selectedModel).toBe(DEFAULT_MODEL)
    expect(state.searchEnabled).toBe(true)
    expect(state.showThinkingTimeline).toBe(true)
    expect(state.showToolActivity).toBe(true)
  })

  it('restores persisted showThinkingTimeline=false', async () => {
    mockGetPreference.mockImplementation((key) =>
      Promise.resolve(key === 'settings_show_thinking_timeline' ? 'false' : undefined)
    )
    await useSettingsStore.getState().initialize()
    expect(useSettingsStore.getState().showThinkingTimeline).toBe(false)
  })

  it('restores persisted showToolActivity=false', async () => {
    mockGetPreference.mockImplementation((key) =>
      Promise.resolve(key === 'settings_show_tool_activity' ? 'false' : undefined)
    )
    await useSettingsStore.getState().initialize()
    expect(useSettingsStore.getState().showToolActivity).toBe(false)
  })

  it('restores persisted searchEnabled=false', async () => {
    mockGetPreference.mockImplementation((key) =>
      Promise.resolve(key === 'settings_search_enabled' ? 'false' : undefined)
    )
    await useSettingsStore.getState().initialize()
    expect(useSettingsStore.getState().searchEnabled).toBe(false)
  })

  it('restores persisted selectedModel', async () => {
    const customModel = 'openai/gpt-4o'
    mockGetPreference.mockImplementation((key) =>
      Promise.resolve(key === 'settings_selected_model' ? customModel : undefined)
    )
    await useSettingsStore.getState().initialize()
    expect(useSettingsStore.getState().selectedModel).toBe(customModel)
  })
})

describe('settings-store setters', () => {
  it('setShowThinkingTimeline persists false to DB and updates store', async () => {
    await useSettingsStore.getState().setShowThinkingTimeline(false)
    expect(mockSetPreference).toHaveBeenCalledWith('settings_show_thinking_timeline', 'false')
    expect(useSettingsStore.getState().showThinkingTimeline).toBe(false)
  })

  it('setShowThinkingTimeline persists true to DB and updates store', async () => {
    useSettingsStore.setState({ showThinkingTimeline: false })
    await useSettingsStore.getState().setShowThinkingTimeline(true)
    expect(mockSetPreference).toHaveBeenCalledWith('settings_show_thinking_timeline', 'true')
    expect(useSettingsStore.getState().showThinkingTimeline).toBe(true)
  })

  it('setShowToolActivity persists false to DB and updates store', async () => {
    await useSettingsStore.getState().setShowToolActivity(false)
    expect(mockSetPreference).toHaveBeenCalledWith('settings_show_tool_activity', 'false')
    expect(useSettingsStore.getState().showToolActivity).toBe(false)
  })

  it('setSearchEnabled persists false to DB and updates store', async () => {
    await useSettingsStore.getState().setSearchEnabled(false)
    expect(mockSetPreference).toHaveBeenCalledWith('settings_search_enabled', 'false')
    expect(useSettingsStore.getState().searchEnabled).toBe(false)
  })

  it('setSelectedModel persists the model id to DB and updates store', async () => {
    const newModel = 'openai/gpt-4o'
    await useSettingsStore.getState().setSelectedModel(newModel)
    expect(mockSetPreference).toHaveBeenCalledWith('settings_selected_model', newModel)
    expect(useSettingsStore.getState().selectedModel).toBe(newModel)
  })
})
