// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { PluginModule, ToolTreeInput, ToolTreeView } from '@tinytinkerer/contracts'
import { applyPluginToolSelection } from '@tinytinkerer/app-core'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

// A real mapper stands in for the tool-tree plugin's summarizeToolTree so the
// panel renders realistic content without importing the concrete plugin package
// (app-browser must never statically depend on a concrete plugin — see
// scripts/check-boundaries.mjs). Mirrors the plugin's actual mapper: sort plugins
// by label, sort tools by id, derive tri-state + counts, drop zero-tool plugins.
const summarizeToolTree = (input: ToolTreeInput): ToolTreeView => {
  const plugins = input.plugins
    .filter((plugin) => plugin.tools.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((plugin) => {
      const tools = [...plugin.tools]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((tool) => ({ id: tool.id, description: tool.description, checked: tool.enabled }))
      const enabledCount = tools.filter((tool) => tool.checked).length
      const checked =
        enabledCount === tools.length
          ? ('all' as const)
          : enabledCount === 0
            ? ('none' as const)
            : ('some' as const)
      return {
        id: plugin.id,
        label: plugin.label,
        checked,
        enabledCount,
        toolCount: tools.length,
        tools
      }
    })
  return {
    plugins,
    enabledCount: plugins.reduce((sum, p) => sum + p.enabledCount, 0),
    toolCount: plugins.reduce((sum, p) => sum + p.toolCount, 0)
  }
}

const toolTreeModule: PluginModule = {
  manifest: {
    id: 'tool-tree',
    label: 'Tool picker (tree view)',
    description: 'tool tree',
    toolTreeDescriptor: { id: 'tool-tree', summarizeToolTree }
  },
  createPlugin: () => ({ id: 'tool-tree' })
}

const webSearchModule: PluginModule = {
  manifest: {
    id: 'web-search',
    label: 'Web search',
    description: 'search',
    toolDescriptors: [
      { id: 'web_search', description: 'Search the web', schema: z.object({}).passthrough() },
      { id: 'web_fetch', description: 'Fetch a URL', schema: z.object({}).passthrough() }
    ]
  },
  createPlugin: () => ({ id: 'web-search' })
}

const codeExecModule: PluginModule = {
  manifest: {
    id: 'code-exec',
    label: 'Code execution',
    description: 'sandbox',
    toolDescriptors: [
      { id: 'run_javascript', description: 'Run JS', schema: z.object({}).passthrough() }
    ]
  },
  createPlugin: () => ({ id: 'code-exec' })
}

// A plugin that contributes no tools at all — must never appear in the tree.
const feedbackModule: PluginModule = {
  manifest: { id: 'send-feedback', label: 'Feedback', description: 'feedback' },
  createPlugin: () => ({ id: 'send-feedback' })
}

let pluginModules: PluginModule[] = []

// A minimal but REAL zustand store (mirrors createSettingsStore) so
// setPluginToolSelection round-trips through the actual app-core policy
// chokepoint (applyPluginToolSelection) and re-renders the panel with the new
// state, just like the production store does. No persistence layer is needed
// here — that flow is covered by settings-store-plugins.test.ts.
type FakeSettingsState = {
  pluginActivation: Record<string, boolean>
  pluginDisabledTools: Record<string, string[]>
  setPluginToolSelection: (
    plugin: { id: string; toolIds: string[] },
    disabledToolIds: string[]
  ) => Promise<void>
}

const makeFakeSettingsStore = (
  pluginActivation: Record<string, boolean>,
  pluginDisabledTools: Record<string, string[]> = {}
) =>
  createStore<FakeSettingsState>((set, get) => ({
    pluginActivation,
    pluginDisabledTools,
    setPluginToolSelection: (plugin, disabledToolIds) => {
      const current = get()
      const result = applyPluginToolSelection(
        { activation: current.pluginActivation, disabledTools: current.pluginDisabledTools },
        plugin,
        disabledToolIds
      )
      set({
        pluginDisabledTools: result.disabledTools,
        ...(result.pluginDisabled ? { pluginActivation: result.activation } : {})
      })
      return Promise.resolve()
    }
  }))

let fakeSettingsStore = makeFakeSettingsStore({})

vi.mock('../src/app.js', () => ({
  useSettingsStore: <T,>(selector: (state: FakeSettingsState) => T): T =>
    useStore(fakeSettingsStore, selector)
}))

vi.mock('../src/plugins/registry.js', () => ({
  loadPluginModules: () => Promise.resolve(pluginModules)
}))

import { ToolTreeSlot, useToolTree } from '../src/tool-tree.js'
import { ToolTreePanel } from '../src/tool-tree-panel.js'
import { renderHook } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

describe('ToolTreeSlot', () => {
  it('renders nothing when the tool-tree plugin is disabled', async () => {
    pluginModules = [toolTreeModule, webSearchModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'web-search': true })

    const { container } = render(<ToolTreeSlot />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.querySelector('[data-testid="tool-tree-toggle"]')).toBeNull()
  })

  it('renders the button once the tool-tree plugin is enabled', async () => {
    pluginModules = [toolTreeModule, webSearchModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true, 'web-search': true })

    render(<ToolTreeSlot />)
    expect(await screen.findByTestId('tool-tree-toggle')).toBeTruthy()
  })

  it('opening shows only ENABLED tool-plugins with correct checkbox states', async () => {
    pluginModules = [toolTreeModule, webSearchModule, codeExecModule, feedbackModule]
    fakeSettingsStore = makeFakeSettingsStore(
      { 'tool-tree': true, 'web-search': true, 'code-exec': false },
      { 'web-search': ['web_fetch'] }
    )

    render(<ToolTreeSlot />)
    const toggle = await screen.findByTestId('tool-tree-toggle')
    fireEvent.click(toggle)

    const panel = await screen.findByTestId('tool-tree-panel')
    // web-search is enabled and has tools → shown, with web_fetch unchecked.
    expect(screen.getByTestId('tool-tree-plugin-web-search')).toBeTruthy()
    expect(screen.getByTestId('tool-tree-tool-web_search')).toHaveProperty('checked', true)
    expect(screen.getByTestId('tool-tree-tool-web_fetch')).toHaveProperty('checked', false)
    // code-exec is disabled → not shown, even though it declares tools.
    expect(screen.queryByTestId('tool-tree-plugin-code-exec')).toBeNull()
    // send-feedback has no tools → never shown.
    expect(screen.queryByTestId('tool-tree-plugin-send-feedback')).toBeNull()
    expect(panel.textContent).not.toContain('Feedback')
  })

  it('unchecking a tool calls through and persists the id in pluginDisabledTools', async () => {
    pluginModules = [toolTreeModule, webSearchModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true, 'web-search': true })

    render(<ToolTreeSlot />)
    fireEvent.click(await screen.findByTestId('tool-tree-toggle'))
    fireEvent.click(await screen.findByTestId('tool-tree-tool-web_fetch'))

    await waitFor(() =>
      expect(fakeSettingsStore.getState().pluginDisabledTools).toEqual({
        'web-search': ['web_fetch']
      })
    )
  })

  it('unchecking the LAST tool of a plugin disables the plugin and removes it from the tree', async () => {
    pluginModules = [toolTreeModule, codeExecModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true, 'code-exec': true })

    render(<ToolTreeSlot />)
    fireEvent.click(await screen.findByTestId('tool-tree-toggle'))
    expect(await screen.findByTestId('tool-tree-plugin-code-exec')).toBeTruthy()

    fireEvent.click(screen.getByTestId('tool-tree-tool-run_javascript'))

    await waitFor(() => {
      expect(fakeSettingsStore.getState().pluginActivation['code-exec']).toBe(false)
      expect(fakeSettingsStore.getState().pluginDisabledTools).toEqual({})
    })
    // The plugin disappears from the tree once it's no longer enabled.
    await waitFor(() => expect(screen.queryByTestId('tool-tree-plugin-code-exec')).toBeNull())
  })

  it("the plugin-level checkbox unchecks all of that plugin's tools", async () => {
    pluginModules = [toolTreeModule, webSearchModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true, 'web-search': true })

    render(<ToolTreeSlot />)
    fireEvent.click(await screen.findByTestId('tool-tree-toggle'))
    fireEvent.click(await screen.findByTestId('tool-tree-plugin-web-search'))

    await waitFor(() =>
      expect(fakeSettingsStore.getState().pluginActivation['web-search']).toBe(false)
    )
  })

  it('shows an empty state when no tool plugins are enabled', async () => {
    pluginModules = [toolTreeModule, webSearchModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true })

    render(<ToolTreeSlot />)
    fireEvent.click(await screen.findByTestId('tool-tree-toggle'))
    const panel = await screen.findByTestId('tool-tree-panel')
    expect(panel.textContent).toContain('No enabled plugins contribute tools.')
  })
})

describe('useToolTree', () => {
  it('resolves the summarizer and builds input from enabled tool plugins', async () => {
    pluginModules = [toolTreeModule, webSearchModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true, 'web-search': true })

    const { result } = renderHook(() => useToolTree())
    await waitFor(() => expect(result.current.summarizer).not.toBeNull())
    expect(result.current.input.plugins).toHaveLength(1)
    expect(result.current.toolIdsByPlugin['web-search']).toEqual(['web_search', 'web_fetch'])
  })
})

describe('ToolTreePanel', () => {
  it('renders an explicit empty state when there are no plugins in the view', () => {
    render(
      <ToolTreePanel
        view={{ plugins: [], enabledCount: 0, toolCount: 0 }}
        toolIdsByPlugin={{}}
        onClose={() => {}}
      />
    )
    expect(screen.getByTestId('tool-tree-panel').textContent).toContain(
      'No enabled plugins contribute tools.'
    )
  })
})
