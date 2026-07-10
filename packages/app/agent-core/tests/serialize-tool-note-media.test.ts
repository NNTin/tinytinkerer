/* eslint-disable @typescript-eslint/require-await -- the ModelProvider test
doubles below implement an async interface (plan/execute/decideNextAction/
synthesize) without needing to await internally; agent-core's package lint
scopes to `src`, but husky lints staged test files, so this interface-noise
rule is disabled for this file (mirrors the inline `require-yield` disables in
react-runtime.test.ts). */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ChatEvent, ReActDecision } from '@tinytinkerer/contracts'
import { ReActRuntime } from '../src/runtime/react-runtime'
import { ToolRegistry } from '../src/tools/registry'
import type { ExecutionContext, ModelProvider } from '../src/types'

// Minimal scripted ModelProvider: replays a fixed decision list, streams the
// given synthesize generator, and exposes each run's `ExecutionContext` (whose
// `notes` are the thing under test) via `onSynthesize`.
const scriptedProvider = (
  decisions: ReActDecision[],
  synthesize: ModelProvider['synthesize'],
  onSynthesize?: (ctx: ExecutionContext) => void
): ModelProvider => {
  let index = 0
  return {
    async plan() {
      return { complexity: 'low', steps: [] }
    },
    async execute() {
      return ''
    },
    async decideNextAction() {
      const decision = decisions[Math.min(index, decisions.length - 1)]
      index += 1
      return decision ?? { kind: 'final' }
    },
    async *synthesize(ctx, options) {
      onSynthesize?.(ctx)
      yield* synthesize(ctx, options)
    }
  }
}

describe('serializeToolNote — media stripping', () => {
  // Inference token fix: a tool's `media` array carries a full base64 dataUrl
  // per item. The note pushed into `context.notes` is fed back into every
  // subsequent model call, so a leaked dataUrl there would bloat the exact
  // prompt this fix targets. `serializeToolNote` must strip it before the note
  // is recorded, keeping only the human-readable `description`.
  it('never leaks a media dataUrl into the tool-result note', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'render-chart',
      description: 'test tool',
      schema: z.object({}),
      async execute() {
        return {
          summary: 'chart rendered',
          media: [
            {
              kind: 'image' as const,
              dataUrl: `data:image/png;base64,${'A'.repeat(500)}`,
              mimeType: 'image/png',
              width: 640,
              height: 480,
              description: 'A bar chart of Q1 sales'
            }
          ]
        }
      }
    })

    let observedNotes: string[] = []
    const provider = scriptedProvider(
      [{ kind: 'action', toolId: 'render-chart', input: {} }, { kind: 'final' }],
      async function* () {
        yield { kind: 'content' as const, text: 'answer' }
      },
      (ctx) => {
        observedNotes = [...ctx.notes]
      }
    )

    const runtime = new ReActRuntime(provider, registry)
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(observedNotes.some((note) => note.includes('data:image'))).toBe(false)
    expect(observedNotes.some((note) => note.includes('A bar chart of Q1 sales'))).toBe(true)
  })
})
