import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ToolRegistry, type Tool } from '../src/index'

// Output contract (issue #287): when a tool declares an `outputSchema`, the registry
// validates the result before returning, so the inspector/timeline consume a checked
// payload. A tool without one keeps returning its raw output unchanged.

describe('ToolRegistry output validation', () => {
  it('validates input through the tool schema before executing', async () => {
    const registry = new ToolRegistry()
    const tool: Tool<{ n: number }, number> = {
      id: 'double',
      description: 'double a number',
      schema: z.object({ n: z.number() }),
      execute: (input) => Promise.resolve(input.n * 2)
    }
    registry.register(tool)

    await expect(registry.run('double', { n: 3 })).resolves.toBe(6)
    await expect(registry.run('double', { n: 'oops' })).rejects.toThrow()
  })

  it('returns the parsed output when an outputSchema is declared', async () => {
    const registry = new ToolRegistry()
    const tool: Tool<unknown, { ok: boolean }> = {
      id: 'status',
      description: 'status',
      schema: z.unknown(),
      outputSchema: z.object({ ok: z.boolean() }),
      // Returns an extra field; the outputSchema strips it.
      execute: () => Promise.resolve({ ok: true, extra: 'x' } as { ok: boolean })
    }
    registry.register(tool)

    await expect(registry.run('status', {})).resolves.toEqual({ ok: true })
  })

  it('throws when the tool output violates its declared outputSchema', async () => {
    const registry = new ToolRegistry()
    const tool: Tool<unknown, unknown> = {
      id: 'bad-output',
      description: 'returns the wrong shape',
      schema: z.unknown(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => Promise.resolve({ ok: 'not-a-boolean' })
    }
    registry.register(tool)

    await expect(registry.run('bad-output', {})).rejects.toThrow()
  })

  it('returns the raw output unchanged when no outputSchema is declared', async () => {
    const registry = new ToolRegistry()
    const tool: Tool<unknown, unknown> = {
      id: 'raw',
      description: 'open output',
      schema: z.unknown(),
      execute: () => Promise.resolve({ anything: [1, 2, 3] })
    }
    registry.register(tool)

    await expect(registry.run('raw', {})).resolves.toEqual({ anything: [1, 2, 3] })
  })
})
