/**
 * The app tool group's catalogue/run-instance seam (issue #480 re-review,
 * finding 5).
 *
 * The property under test is that ONE definition site serves both the picker and
 * the runtime. A group used to be allowed to carry a `tools` array plus a
 * separate `createTools` builder, with a comment asking for the two to be kept in
 * lockstep — an invariant nothing enforced, over a boundary where a mismatch
 * means the reader's tool selection is applied to tools they never saw.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  appToolCatalogue,
  createAppToolRunInstances,
  type AppTool,
  type AppToolGroup
} from '../src/app-tool-group'

const tool = (id: string, description = `the ${id} tool`): AppTool => ({
  id,
  description,
  schema: z.object({}),
  execute: () => Promise.resolve({})
})

describe('a group whose tools are a plain array', () => {
  const group: AppToolGroup = { id: 'canvas', label: 'Canvas', tools: [tool('a'), tool('b')] }

  it('serves the same instances to the picker and to every run', () => {
    expect(appToolCatalogue(group)).toBe(group.tools)
    expect(createAppToolRunInstances(group)).toBe(group.tools)
  })
})

describe('a group whose tools are a factory', () => {
  it('derives the catalogue once and keeps it stable', () => {
    const factory = vi.fn(() => [tool('a'), tool('b')])
    const group: AppToolGroup = { id: 'docs', label: 'Docs', tools: factory }

    const first = appToolCatalogue(group)
    const second = appToolCatalogue(group)

    // Identity matters: the picker reads the catalogue inside a `useMemo` keyed
    // on the group, so a fresh array every render would re-render the tree
    // forever.
    expect(second).toBe(first)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('tells the factory which one it is building', () => {
    const purposes: string[] = []
    const group: AppToolGroup = {
      id: 'docs',
      label: 'Docs',
      tools: (purpose) => {
        purposes.push(purpose)
        return [tool('a')]
      }
    }

    appToolCatalogue(group)
    createAppToolRunInstances(group)

    expect(purposes).toEqual(['catalogue', 'run'])
  })

  it('builds fresh instances for each run', () => {
    let runs = 0
    const group: AppToolGroup = {
      id: 'docs',
      label: 'Docs',
      tools: () => {
        const captured = runs++
        return [{ ...tool('a'), description: `run ${captured}` }]
      }
    }

    const one = createAppToolRunInstances(group)
    const two = createAppToolRunInstances(group)

    expect(one[0]).not.toBe(two[0])
    expect(one[0]?.description).not.toBe(two[0]?.description)
  })

  it('fails hard when a run omits a tool the reader can see in the picker', () => {
    let first = true
    const group: AppToolGroup = {
      id: 'docs',
      label: 'Docs',
      tools: () => {
        if (first) {
          first = false
          return [tool('a'), tool('b')]
        }
        return [tool('a')]
      }
    }

    appToolCatalogue(group)
    expect(() => createAppToolRunInstances(group)).toThrowError(/missing: b/)
  })

  it('fails hard when a run contributes a tool the picker never listed', () => {
    let first = true
    const group: AppToolGroup = {
      id: 'docs',
      label: 'Docs',
      tools: () => {
        if (first) {
          first = false
          return [tool('a')]
        }
        return [tool('a'), tool('ghost')]
      }
    }

    appToolCatalogue(group)
    expect(() => createAppToolRunInstances(group)).toThrowError(/unexpected: ghost/)
  })

  it('rejects duplicate ids, which a runtime registry cannot represent', () => {
    const group: AppToolGroup = {
      id: 'docs',
      label: 'Docs',
      tools: () => [tool('a'), tool('a')]
    }

    expect(() => appToolCatalogue(group)).toThrowError(/more than one tool with id "a"/)
  })
})
