// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const controller = vi.hoisted(() => ({
  effectiveStatus: {
    auth: { state: 'ready', detail: 'GitHub auth available' },
    models: { state: 'ready', detail: 'Models ready' }
  },
  refreshStatus: vi.fn(),
  token: null as string | null,
  clearToken: vi.fn(),
  setToken: vi.fn(),
  canStartGitHubOAuth: true,
  startGitHubOAuth: vi.fn(),
  user: null,
  models: [{ id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' }],
  isRefreshingModels: false,
  modelsRefreshError: null,
  refreshModels: vi.fn(),
  selectedModel: 'openai/gpt-4.1-mini',
  setSelectedModel: vi.fn(),
  litellmBaseUrl: '',
  litellmBaseUrlError: null,
  setLiteLLMBaseUrl: vi.fn(),
  agentType: 'hybrid' as const,
  setAgentType: vi.fn(),
  webSpeechEnabled: false,
  setWebSpeechEnabled: vi.fn(),
  showReasoningActivity: true,
  setShowReasoningActivity: vi.fn(),
  showCodeBlockFullscreenButton: true,
  setShowCodeBlockFullscreenButton: vi.fn(),
  mcpServers: [],
  mcpDiscovery: {},
  addMcpServer: vi.fn(),
  updateMcpServer: vi.fn(),
  removeMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  refreshMcpServer: vi.fn(),
  telemetryEnabled: true,
  setTelemetryEnabled: vi.fn(),
  availablePlugins: [
    { id: 'web-search', label: 'Web search', description: 'Search the web.' },
    {
      id: 'choice-prompt',
      label: 'Choice prompt',
      description: 'Ask you a question.',
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
  ],
  pluginActivation: { 'choice-prompt': true },
  setPluginEnabled: vi.fn(),
  pluginConfig: {},
  setPluginSetting: vi.fn()
}))

vi.mock('../src/surfaces.js', () => ({
  useSettingsSurfaceController: () => controller
}))

import { SettingsPanel } from '../src/browser-settings-modal.js'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('SettingsPanel (B2)', () => {
  it('renders the four tabs and shows Account first', () => {
    render(<SettingsPanel open onOpenChange={vi.fn()} />)
    const tablist = screen.getByRole('tablist', { name: 'Settings sections' })
    for (const label of ['Account', 'Models', 'Tools', 'Privacy']) {
      expect(within(tablist).getByRole('tab', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('region', { name: 'Auth' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Plugins' })).toBeNull()
  })

  it('switches sections when a tab is clicked', () => {
    render(<SettingsPanel open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }))
    expect(screen.getByRole('region', { name: 'MCP Servers' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Plugins' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Models' }))
    expect(screen.getByRole('region', { name: 'Models' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Interface' })).toBeInTheDocument()
  })

  it('moves between tabs with arrow keys', () => {
    render(<SettingsPanel open onOpenChange={vi.fn()} />)
    const account = screen.getByRole('tab', { name: 'Account' })
    fireEvent.keyDown(account, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Models' })).toHaveAttribute('aria-selected', 'true')
  })

  it('renders a modal dialog for the modal presentation', () => {
    render(<SettingsPanel open onOpenChange={vi.fn()} presentation="modal" />)
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('data-presentation', 'modal')
  })

  it('renders a contained, non-modal slide-over for the inline presentation', () => {
    render(<SettingsPanel open onOpenChange={vi.fn()} presentation="inline" />)
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog).toHaveAttribute('aria-modal', 'false')
    expect(dialog).toHaveAttribute('data-presentation', 'inline')
  })

  it('closes on Escape', () => {
    const onOpenChange = vi.fn()
    render(<SettingsPanel open onOpenChange={onOpenChange} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders an enabled plugin’s declared dropdown setting and persists a change', () => {
    render(<SettingsPanel open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }))

    // The choice-prompt plugin is enabled and declares a `presentation` enum field,
    // so the host renders it generically as a labelled dropdown.
    const dropdown = screen.getByLabelText('Question style')
    expect(dropdown).toHaveValue('modal')
    expect(
      within(dropdown)
        .getAllByRole<HTMLOptionElement>('option')
        .map((option) => option.value)
    ).toEqual(['modal', 'composer'])

    fireEvent.change(dropdown, { target: { value: 'composer' } })
    expect(controller.setPluginSetting).toHaveBeenCalledWith(
      'choice-prompt',
      'presentation',
      'composer'
    )
  })
})
