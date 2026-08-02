/**
 * The app tool group's catalogue/run-instance seam (issue #480 re-review,
 * finding 1).
 *
 * The property under test is that the catalogue is the ONLY place a tool's
 * metadata is written. A group used to be able to supply a factory that was
 * called once for the picker and again for every run; the two calls were
 * validated against each other by id, which left every other field — description,
 * input and output schema, summarizer — free to differ between what the reader
 * selected in the picker and what the model was handed. A run may now supply a
 * BODY for a tool the catalogue already declares, and nothing else.
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

describe('a group with no run bindings', () => {
  const group: AppToolGroup = { id: 'canvas', label: 'Canvas', tools: [tool('a'), tool('b')] }

  it('serves the same instances to the picker and to every run', () => {
    // Identity matters in both directions: the picker reads the catalogue inside
    // a `useMemo` keyed on the group, and a stateless tool has no reason to be
    // reallocated per run.
    expect(appToolCatalogue(group)).toBe(group.tools)
    expect(createAppToolRunInstances(group)).toBe(group.tools)
  })

  it('rejects duplicate ids, which a runtime registry cannot represent', () => {
    const duplicated: AppToolGroup = {
      id: 'docs',
      label: 'Docs',
      tools: [tool('a'), tool('a')]
    }

    expect(() => appToolCatalogue(duplicated)).toThrowError(/more than one tool with id "a"/)
  })
})

describe('a group that binds per-run implementations', () => {
  const boundGroup = (bindRun: AppToolGroup['bindRun']): AppToolGroup => ({
    id: 'docs',
    label: 'Docs',
    tools: [tool('stateless'), tool('pinned')],
    ...(bindRun ? { bindRun } : {})
  })

  it('replaces only the bound tool, and only its body', async () => {
    const group = boundGroup(() => ({
      pinned: { execute: () => Promise.resolve({ pinned: true }) }
    }))

    const catalogue = appToolCatalogue(group)
    const instances = createAppToolRunInstances(group)

    // Same tools, same order, same metadata — the run instances ARE the
    // catalogue, with one body swapped.
    expect(instances.map((instance) => instance.id)).toEqual(['stateless', 'pinned'])
    expect(instances[1]?.description).toBe(catalogue[1]?.description)
    expect(instances[1]?.schema).toBe(catalogue[1]?.schema)
    // A tool with no binding is not even reallocated.
    expect(instances[0]).toBe(catalogue[0])
    await expect(instances[1]?.execute({})).resolves.toEqual({ pinned: true })
  })

  it('binds afresh for every run, so each captures its own context', async () => {
    let runs = 0
    const group = boundGroup(() => {
      const captured = runs++
      return { pinned: { execute: () => Promise.resolve({ run: captured }) } }
    })

    const one = createAppToolRunInstances(group)
    const two = createAppToolRunInstances(group)

    await expect(one[1]?.execute({})).resolves.toEqual({ run: 0 })
    await expect(two[1]?.execute({})).resolves.toEqual({ run: 1 })
  })

  it('leaves the catalogue itself untouched by a run', async () => {
    const group = boundGroup(() => ({
      pinned: { execute: () => Promise.resolve({ pinned: true }) }
    }))
    const before = appToolCatalogue(group)

    createAppToolRunInstances(group)

    expect(appToolCatalogue(group)).toBe(before)
    await expect(before[1]?.execute({})).resolves.toEqual({})
  })

  it('fails hard when a binding names a tool the group does not declare', () => {
    const group = boundGroup(() => ({ ghost: { execute: () => Promise.resolve({}) } }))

    // Silent otherwise: the reader's selection would be applied to a catalogue
    // tool still carrying the context-free body, and nothing would say so.
    expect(() => createAppToolRunInstances(group)).toThrowError(
      /bound per-run implementations for tools it does not declare: ghost/
    )
  })

  it('does not call the binder to derive the catalogue', () => {
    const bindRun = vi.fn(() => ({}))
    const group = boundGroup(bindRun)

    appToolCatalogue(group)
    appToolCatalogue(group)

    // A binder captures "what was true when the reader hit send". The catalogue
    // is derived whenever the picker first renders and is never executed, so
    // binding it would pin context no reader ever asked about.
    expect(bindRun).not.toHaveBeenCalled()
  })
})
