// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@tinytinkerer/contracts'

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
  mcpServers: [] as McpServerConfig[],
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

// The Privacy tab renders the app's pre-send disclosure (issue #481) when it has
// one. This panel is exercised without a provider, so the store hook is mocked
// to the "no disclosure" shape every product app has.
vi.mock('../src/pre-send-disclosure.js', () => ({
  usePreSendDisclosureStore: (selector: (state: { disclosure: undefined }) => unknown) =>
    selector({ disclosure: undefined })
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
    const models = screen.getByRole('tab', { name: 'Models' })
    expect(models).toHaveAttribute('aria-selected', 'true')
    // Roving tabindex (issue #355): DOM focus and tab-stop follow the selection.
    expect(document.activeElement).toBe(models)
    expect(models.tabIndex).toBe(0)
    expect(account.tabIndex).toBe(-1)

    // ArrowLeft from the first tab wraps to the last one and focuses it.
    fireEvent.click(account)
    fireEvent.keyDown(account, { key: 'ArrowLeft' })
    const privacy = screen.getByRole('tab', { name: 'Privacy' })
    expect(privacy).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(privacy)
  })

  it('moves focus into the dialog when opened', () => {
    render(<SettingsPanel open onOpenChange={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    // Initial focus lands on the first focusable inside the dialog (issue #353).
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Close settings' })
    )
  })

  it('traps Tab at the dialog boundaries', () => {
    render(<SettingsPanel open onOpenChange={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1)
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('restores focus to the previously focused element on close', () => {
    const onOpenChange = vi.fn()
    const view = (open: boolean) => (
      <>
        <button>trigger</button>
        <SettingsPanel open={open} onOpenChange={onOpenChange} />
      </>
    )
    const { rerender } = render(view(false))
    const trigger = screen.getByRole('button', { name: 'trigger' })
    trigger.focus()

    rerender(view(true))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toContainElement(
      document.activeElement as HTMLElement
    )

    rerender(view(false))
    expect(document.activeElement).toBe(trigger)
  })

  it('gives MCP row controls stable accessible names and confirms removal', () => {
    controller.mcpServers = [
      { id: 's1', name: 'docs-server', url: 'https://mcp.example.com/mcp', enabled: true }
    ]
    try {
      render(<SettingsPanel open onOpenChange={vi.fn()} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Tools' }))

      // Names stay stable across state (issue #354): the checked state itself
      // conveys on/off, so the checkbox label never flips.
      expect(screen.getByRole('checkbox', { name: 'Enable docs-server' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Refresh docs-server' })).toBeInTheDocument()

      // Removal is destructive: the first click only arms the button.
      fireEvent.click(screen.getByRole('button', { name: 'Remove docs-server' }))
      expect(controller.removeMcpServer).not.toHaveBeenCalled()
      const confirm = screen.getByRole('button', { name: 'Confirm removing docs-server' })
      expect(confirm).toHaveTextContent('Remove?')

      fireEvent.click(confirm)
      expect(controller.removeMcpServer).toHaveBeenCalledWith('s1')
    } finally {
      controller.mcpServers = []
    }
  })

  it('uses theme tokens (not hardcoded stone) for text on the panel surface', () => {
    render(<SettingsPanel open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Models' }))

    // Text sitting directly on the var(--panel) surface must follow the theme
    // (issue #357) so it stays readable in dark mode.
    const modelLabel = screen.getByText('Model', { selector: 'label' })
    expect(modelLabel.className).toContain('text-[var(--text)]')
    expect(modelLabel.className).not.toMatch(/stone/)

    const toggleLabel = screen.getByText('Show reasoning & activity')
    expect(toggleLabel.className).toContain('text-[var(--text)]')
    expect(toggleLabel.className).not.toMatch(/stone/)
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
