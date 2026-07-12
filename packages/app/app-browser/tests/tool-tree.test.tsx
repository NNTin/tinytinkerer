// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { PluginModule, ToolTreeInput, ToolTreeView } from '@tinytinkerer/contracts'
import { applyAppToolSelection, applyPluginToolSelection } from '@tinytinkerer/app-core'
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

// A LOSSY summarizer — regression coverage for issue #400 review F3 (the view is
// DISPLAY-ONLY): it drops 'web_fetch' entirely from the rendered tree, the way a
// real summarizer might for presentation (e.g. a "featured tools" grouping).
// Toggling a tool that IS rendered must never touch the omitted one.
const lossySummarizeToolTree = (input: ToolTreeInput): ToolTreeView => {
  const plugins = input.plugins
    .filter((plugin) => plugin.tools.length > 0)
    .map((plugin) => {
      const tools = plugin.tools
        .filter((tool) => tool.id !== 'web_fetch')
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

const lossyToolTreeModule: PluginModule = {
  manifest: {
    id: 'tool-tree',
    label: 'Tool picker (tree view)',
    description: 'tool tree',
    toolTreeDescriptor: { id: 'tool-tree', summarizeToolTree: lossySummarizeToolTree }
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
  appToolDisablement: Record<string, string[]>
  setPluginToolSelection: (
    plugin: { id: string; toolIds: string[] },
    disabledToolIds: string[]
  ) => Promise<void>
  setAppToolSelection: (
    group: { id: string; toolIds: string[] },
    disabledToolIds: string[]
  ) => Promise<void>
}

const makeFakeSettingsStore = (
  pluginActivation: Record<string, boolean>,
  pluginDisabledTools: Record<string, string[]> = {},
  appToolDisablement: Record<string, string[]> = {}
) =>
  createStore<FakeSettingsState>((set, get) => ({
    pluginActivation,
    pluginDisabledTools,
    appToolDisablement,
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
    },
    setAppToolSelection: (group, disabledToolIds) => {
      const next = applyAppToolSelection(get().appToolDisablement, group, disabledToolIds)
      set({ appToolDisablement: next })
      return Promise.resolve()
    }
  }))

let fakeSettingsStore = makeFakeSettingsStore({})
// The app tool group the fake useBrowserApp exposes; individual tests set it before
// rendering. Undefined = a shell with no app tools (web/widget/mobile).
let fakeAppToolGroup:
  | { id: string; label: string; tools: { id: string; description: string }[] }
  | undefined

vi.mock('../src/app.js', () => ({
  useSettingsStore: <T,>(selector: (state: FakeSettingsState) => T): T =>
    useStore(fakeSettingsStore, selector),
  useBrowserApp: () => ({ appToolGroup: fakeAppToolGroup })
}))

vi.mock('../src/plugins/registry.js', () => ({
  loadPluginModules: () => Promise.resolve(pluginModules)
}))

import { ToolTreeSlot, useToolTree } from '../src/tool-tree.js'
import { ToolTreePanel } from '../src/tool-tree-panel.js'
import { renderHook } from '@testing-library/react'

afterEach(() => {
  cleanup()
  fakeAppToolGroup = undefined
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

  // Issue #400 review, F3: the panel must derive policy (the denylist it sends
  // to setPluginToolSelection) from HOST STATE (toolIdsByPlugin +
  // pluginDisabledTools), never from the rendered `view` — a summarizer is free
  // to be lossy for presentation. With a summarizer that omits 'web_fetch' from
  // the tree entirely, unchecking the ONE tool that IS rendered must persist a
  // denylist containing ONLY that tool; the omitted tool must not be swept in
  // (re-enabled/disabled) as a side effect.
  it('a LOSSY summarizer omitting a tool never touches that tool when a different one is toggled', async () => {
    pluginModules = [lossyToolTreeModule, webSearchModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true, 'web-search': true })

    render(<ToolTreeSlot />)
    fireEvent.click(await screen.findByTestId('tool-tree-toggle'))

    // 'web_fetch' is omitted by the lossy summarizer — never rendered.
    expect(screen.queryByTestId('tool-tree-tool-web_fetch')).toBeNull()

    fireEvent.click(await screen.findByTestId('tool-tree-tool-web_search'))

    await waitFor(() =>
      expect(fakeSettingsStore.getState().pluginDisabledTools).toEqual({
        'web-search': ['web_search']
      })
    )
  })
})

// Issue #400 follow-up: an app's always-on tools (e.g. the canvas Excalidraw
// verbs) appear in the SAME picker as plugin tools, but with a distinct policy —
// no activation toggle, so unchecking every tool keeps the group visible.
describe('app tool group', () => {
  const canvasGroup = {
    id: 'canvas',
    label: 'Canvas',
    tools: [
      { id: 'draw', description: 'Draw shapes' },
      { id: 'search', description: 'Find elements' }
    ]
  }

  it('shows the app group beside enabled plugins', async () => {
    pluginModules = [toolTreeModule, webSearchModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true, 'web-search': true })
    fakeAppToolGroup = canvasGroup

    render(<ToolTreeSlot />)
    fireEvent.click(await screen.findByTestId('tool-tree-toggle'))

    expect(await screen.findByTestId('tool-tree-plugin-canvas')).toBeTruthy()
    expect(screen.getByTestId('tool-tree-tool-draw')).toHaveProperty('checked', true)
    expect(screen.getByTestId('tool-tree-plugin-web-search')).toBeTruthy()
  })

  it('shows the app group even when the tool-tree plugin is the only enabled plugin', async () => {
    pluginModules = [toolTreeModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true })
    fakeAppToolGroup = canvasGroup

    render(<ToolTreeSlot />)
    fireEvent.click(await screen.findByTestId('tool-tree-toggle'))

    expect(await screen.findByTestId('tool-tree-plugin-canvas')).toBeTruthy()
  })

  it('unchecking an app tool persists to appToolDisablement, not pluginDisabledTools', async () => {
    pluginModules = [toolTreeModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true })
    fakeAppToolGroup = canvasGroup

    render(<ToolTreeSlot />)
    fireEvent.click(await screen.findByTestId('tool-tree-toggle'))
    fireEvent.click(await screen.findByTestId('tool-tree-tool-draw'))

    await waitFor(() =>
      expect(fakeSettingsStore.getState().appToolDisablement).toEqual({ canvas: ['draw'] })
    )
    // The plugin denylist and plugin activation are untouched — app tools are a
    // separate namespace with no activation.
    expect(fakeSettingsStore.getState().pluginDisabledTools).toEqual({})
    expect(fakeSettingsStore.getState().pluginActivation).toEqual({ 'tool-tree': true })
  })

  it('unchecking ALL app tools keeps the group visible (no activation flip)', async () => {
    pluginModules = [toolTreeModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true })
    fakeAppToolGroup = canvasGroup

    render(<ToolTreeSlot />)
    fireEvent.click(await screen.findByTestId('tool-tree-toggle'))
    // The group-level checkbox unchecks every tool at once.
    fireEvent.click(await screen.findByTestId('tool-tree-plugin-canvas'))

    await waitFor(() =>
      expect(fakeSettingsStore.getState().appToolDisablement).toEqual({
        canvas: ['draw', 'search']
      })
    )
    // Unlike a plugin, the group stays in the tree with every tool unchecked.
    expect(screen.getByTestId('tool-tree-plugin-canvas')).toBeTruthy()
    expect(screen.getByTestId('tool-tree-tool-draw')).toHaveProperty('checked', false)
    // No activation entry was created for the app group.
    expect(fakeSettingsStore.getState().pluginActivation).toEqual({ 'tool-tree': true })
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
    expect(result.current.appGroupIds).toEqual([])
  })

  it('includes the app group in input and appGroupIds when one is present', async () => {
    pluginModules = [toolTreeModule]
    fakeSettingsStore = makeFakeSettingsStore({ 'tool-tree': true })
    fakeAppToolGroup = {
      id: 'canvas',
      label: 'Canvas',
      tools: [{ id: 'draw', description: 'Draw shapes' }]
    }

    const { result } = renderHook(() => useToolTree())
    await waitFor(() => expect(result.current.appGroupIds).toEqual(['canvas']))
    expect(result.current.toolIdsByPlugin['canvas']).toEqual(['draw'])
    expect(result.current.input.plugins.some((p) => p.id === 'canvas')).toBe(true)
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
