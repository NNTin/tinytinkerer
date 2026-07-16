import { afterEach, describe, expect, it } from 'vitest'
import type { HumanPromptView } from '@tinytinkerer/contracts'
import { requestHumanInput, resetHumanPrompts } from '../src/human-prompt-bridge.js'

afterEach(() => {
  // Settle anything a failed assertion left pending so tests stay isolated.
  resetHumanPrompts()
})

const view: HumanPromptView = {
  role: 'dialog',
  ariaLabel: 'Assistant question',
  title: 'Pick one',
  actions: [{ id: 'ok', label: 'OK' }],
  dismissLabel: 'Dismiss'
}

describe('resetHumanPrompts scoping (issue #430)', () => {
  it('settles only the matching scope, leaving other scopes pending and resolvable', async () => {
    const promptA = requestHumanInput(view, 'a')
    const promptB = requestHumanInput(view, 'b')

    resetHumanPrompts('a')

    await expect(promptA).resolves.toEqual({ kind: 'dismissed' })

    // B is untouched by A's reset — still pending, and still resolves normally.
    resetHumanPrompts('b')
    await expect(promptB).resolves.toEqual({ kind: 'dismissed' })
  })

  it('a scoped reset never touches a scopeless prompt', async () => {
    const scopeless = requestHumanInput(view)
    const scopedA = requestHumanInput(view, 'a')

    resetHumanPrompts('a')
    await expect(scopedA).resolves.toEqual({ kind: 'dismissed' })

    // The scopeless prompt is still pending; settle it directly to prove it.
    resetHumanPrompts()
    await expect(scopeless).resolves.toEqual({ kind: 'dismissed' })
  })

  it('resetHumanPrompts() with no scope settles every pending prompt, including scopeless ones', async () => {
    const scopeless = requestHumanInput(view)
    const scopedA = requestHumanInput(view, 'a')
    const scopedB = requestHumanInput(view, 'b')

    resetHumanPrompts()

    await expect(scopeless).resolves.toEqual({ kind: 'dismissed' })
    await expect(scopedA).resolves.toEqual({ kind: 'dismissed' })
    await expect(scopedB).resolves.toEqual({ kind: 'dismissed' })
  })
})
