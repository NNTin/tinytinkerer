import { isPluginModule, type ToolTreeInput } from '@tinytinkerer/contracts'
import { describe, expect, it } from 'vitest'
import * as toolTreeModule from '../src/index'
import {
  TOOL_TREE_PLUGIN_ID,
  summarizeToolTree,
  toolTreePlugin,
  toolTreePluginManifest
} from '../src/index'

describe('summarizeToolTree', () => {
  it('returns an empty view for empty input', () => {
    const view = summarizeToolTree({ plugins: [] })
    expect(view).toEqual({ plugins: [], enabledCount: 0, toolCount: 0 })
  })

  it('sorts plugins by label and tools by id', () => {
    const input: ToolTreeInput = {
      plugins: [
        {
          id: 'zeta-plugin',
          label: 'Alpha zone',
          tools: [
            { id: 'z_tool', description: 'z', enabled: true },
            { id: 'a_tool', description: 'a', enabled: true }
          ]
        },
        {
          id: 'beta-plugin',
          label: 'Beta zone',
          tools: [{ id: 'b_tool', description: 'b', enabled: true }]
        }
      ]
    }

    const view = summarizeToolTree(input)
    expect(view.plugins.map((p) => p.label)).toEqual(['Alpha zone', 'Beta zone'])
    expect(view.plugins[0]?.tools.map((t) => t.id)).toEqual(['a_tool', 'z_tool'])
  })

  it('derives checked=all when every tool of a plugin is enabled', () => {
    const view = summarizeToolTree({
      plugins: [
        {
          id: 'p1',
          label: 'Plugin One',
          tools: [
            { id: 't1', description: 'd1', enabled: true },
            { id: 't2', description: 'd2', enabled: true }
          ]
        }
      ]
    })

    expect(view.plugins[0]).toMatchObject({ checked: 'all', enabledCount: 2, toolCount: 2 })
  })

  it('derives checked=some for a partial selection', () => {
    const view = summarizeToolTree({
      plugins: [
        {
          id: 'p1',
          label: 'Plugin One',
          tools: [
            { id: 't1', description: 'd1', enabled: true },
            { id: 't2', description: 'd2', enabled: false }
          ]
        }
      ]
    })

    expect(view.plugins[0]).toMatchObject({ checked: 'some', enabledCount: 1, toolCount: 2 })
  })

  it('derives checked=none when no tool of a plugin is enabled', () => {
    const view = summarizeToolTree({
      plugins: [
        {
          id: 'p1',
          label: 'Plugin One',
          tools: [
            { id: 't1', description: 'd1', enabled: false },
            { id: 't2', description: 'd2', enabled: false }
          ]
        }
      ]
    })

    expect(view.plugins[0]).toMatchObject({ checked: 'none', enabledCount: 0, toolCount: 2 })
  })

  it('sums enabled/total tool counts across plugins on the view', () => {
    const view = summarizeToolTree({
      plugins: [
        {
          id: 'p1',
          label: 'Plugin One',
          tools: [
            { id: 't1', description: 'd1', enabled: true },
            { id: 't2', description: 'd2', enabled: false }
          ]
        },
        {
          id: 'p2',
          label: 'Plugin Two',
          tools: [{ id: 't3', description: 'd3', enabled: true }]
        }
      ]
    })

    expect(view.enabledCount).toBe(2)
    expect(view.toolCount).toBe(3)
  })

  it('drops a plugin with zero declared tools defensively', () => {
    const view = summarizeToolTree({
      plugins: [
        { id: 'empty-plugin', label: 'Empty', tools: [] },
        {
          id: 'p1',
          label: 'Plugin One',
          tools: [{ id: 't1', description: 'd1', enabled: true }]
        }
      ]
    })

    expect(view.plugins).toHaveLength(1)
    expect(view.plugins[0]?.id).toBe('p1')
  })
})

describe('manifest', () => {
  it('is a valid, off-by-default tool-tree plugin module', () => {
    expect(isPluginModule(toolTreeModule)).toBe(true)
    expect(toolTreePluginManifest.id).toBe(TOOL_TREE_PLUGIN_ID)
    expect(toolTreePluginManifest.defaultEnabled).toBeUndefined()
    expect(toolTreePluginManifest.toolTreeDescriptor?.summarizeToolTree).toBe(summarizeToolTree)
    expect(toolTreePlugin().id).toBe(TOOL_TREE_PLUGIN_ID)
  })
})
