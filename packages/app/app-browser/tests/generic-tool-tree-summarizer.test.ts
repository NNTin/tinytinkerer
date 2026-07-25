import { describe, expect, it } from 'vitest'
import { genericToolTreeSummarizer } from '../src/generic-tool-tree-summarizer.js'

describe('genericToolTreeSummarizer', () => {
  it('drops owners with zero tools', () => {
    const view = genericToolTreeSummarizer({
      plugins: [{ id: 'empty', label: 'Empty', tools: [] }]
    })
    expect(view.plugins).toEqual([])
    expect(view.enabledCount).toBe(0)
    expect(view.toolCount).toBe(0)
  })

  it('sorts owners by label and tools by id, and derives tri-state + counts', () => {
    const view = genericToolTreeSummarizer({
      plugins: [
        {
          id: 'zeta',
          label: 'Zeta',
          tools: [{ id: 'z_tool', description: 'z', enabled: true }]
        },
        {
          id: 'alpha',
          label: 'Alpha',
          tools: [
            { id: 'b_tool', description: 'b', enabled: false },
            { id: 'a_tool', description: 'a', enabled: true }
          ]
        }
      ]
    })

    expect(view.plugins.map((plugin) => plugin.id)).toEqual(['alpha', 'zeta'])
    expect(view.plugins[0]?.tools.map((tool) => tool.id)).toEqual(['a_tool', 'b_tool'])
    expect(view.plugins[0]?.checked).toBe('some')
    expect(view.plugins[0]?.enabledCount).toBe(1)
    expect(view.plugins[0]?.toolCount).toBe(2)
    expect(view.plugins[1]?.checked).toBe('all')
    expect(view.enabledCount).toBe(2)
    expect(view.toolCount).toBe(3)
  })

  it('reports "none" when every tool of an owner is disabled', () => {
    const view = genericToolTreeSummarizer({
      plugins: [
        {
          id: 'canvas',
          label: 'Canvas',
          tools: [{ id: 'draw', description: 'Draw', enabled: false }]
        }
      ]
    })
    expect(view.plugins[0]?.checked).toBe('none')
  })
})
