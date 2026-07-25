import { describe, expect, it } from 'vitest'
import { PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID, pluginToolPickerDemoToolGroup } from '../demo-tools'

const toolById = (id: string) => {
  const tool = pluginToolPickerDemoToolGroup.tools.find((candidate) => candidate.id === id)
  if (!tool) throw new Error(`missing demo tool ${id}`)
  return tool
}

describe('pluginToolPickerDemoToolGroup', () => {
  it('carries the stable group id and three demo tools', () => {
    expect(pluginToolPickerDemoToolGroup.id).toBe(PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID)
    expect(pluginToolPickerDemoToolGroup.tools.map((tool) => tool.id).sort()).toEqual([
      'lab_always_fails',
      'lab_explain_plugin_concept',
      'lab_roll_dice'
    ])
  })

  it('lab_roll_dice rolls the requested count of dice within range', async () => {
    const tool = toolById('lab_roll_dice')
    const parsed = tool.schema.parse({ sides: 6, count: 3 }) as { sides: number; count: number }
    const result = (await tool.execute(parsed)) as { rolls: number[]; total: number }
    expect(result.rolls).toHaveLength(3)
    for (const roll of result.rolls) {
      expect(roll).toBeGreaterThanOrEqual(1)
      expect(roll).toBeLessThanOrEqual(6)
    }
    expect(result.total).toBe(result.rolls.reduce((sum, roll) => sum + roll, 0))
  })

  it('lab_explain_plugin_concept returns the requested topic explanation', async () => {
    const tool = toolById('lab_explain_plugin_concept')
    const parsed = tool.schema.parse({ topic: 'activation' }) as { topic: string }
    const result = (await tool.execute(parsed)) as { topic: string; explanation: string }
    expect(result.topic).toBe('activation')
    expect(result.explanation.length).toBeGreaterThan(0)
  })

  it('lab_always_fails always throws', async () => {
    const tool = toolById('lab_always_fails')
    const parsed = tool.schema.parse({}) as Record<string, unknown>
    await expect(tool.execute(parsed)).rejects.toThrow(/always fails/)
  })
})
