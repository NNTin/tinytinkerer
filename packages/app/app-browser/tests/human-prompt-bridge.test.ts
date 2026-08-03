import { describe, expect, it } from 'vitest'
import type { HumanPromptView } from '@tinytinkerer/contracts'
import { createHumanPromptStore } from '../src/human-prompt-bridge.js'

// No shared teardown: every test builds its own store, so nothing a failed
// assertion leaves pending can reach another test. That isolation is the point
// of #489 rather than a testing convenience — the module-level queue this
// replaced needed an `afterEach` reset precisely because it was one queue for
// the whole process.

const view: HumanPromptView = {
  role: 'dialog',
  ariaLabel: 'Assistant question',
  title: 'Pick one',
  actions: [{ id: 'ok', label: 'OK' }],
  dismissLabel: 'Dismiss'
}

/** Resolves to `pending` iff `promise` has not settled. */
const pendingSentinel = Symbol('pending')
const settlementOf = (promise: Promise<unknown>): Promise<unknown> =>
  Promise.race([promise, Promise.resolve(pendingSentinel)])

describe('reset scoping within one app (issue #430)', () => {
  it('settles only the matching scope, leaving other scopes pending and resolvable', async () => {
    const { request, reset } = createHumanPromptStore().getState()
    const promptA = request(view, 'a')
    const promptB = request(view, 'b')

    reset('a')

    await expect(promptA).resolves.toEqual({ kind: 'dismissed' })

    // B is untouched by A's reset — still pending, and still resolves normally.
    reset('b')
    await expect(promptB).resolves.toEqual({ kind: 'dismissed' })
  })

  it('a scoped reset never touches a scopeless prompt', async () => {
    const { request, reset } = createHumanPromptStore().getState()
    const scopeless = request(view)
    const scopedA = request(view, 'a')

    reset('a')
    await expect(scopedA).resolves.toEqual({ kind: 'dismissed' })

    // The scopeless prompt is still pending; settle it directly to prove it.
    reset()
    await expect(scopeless).resolves.toEqual({ kind: 'dismissed' })
  })

  it('reset() with no scope settles every pending prompt, including scopeless ones', async () => {
    const { request, reset } = createHumanPromptStore().getState()
    const scopeless = request(view)
    const scopedA = request(view, 'a')
    const scopedB = request(view, 'b')

    reset()

    await expect(scopeless).resolves.toEqual({ kind: 'dismissed' })
    await expect(scopedA).resolves.toEqual({ kind: 'dismissed' })
    await expect(scopedB).resolves.toEqual({ kind: 'dismissed' })
  })
})

describe('one queue per app (issue #489)', () => {
  it('keeps each app’s prompts out of the other’s queue', () => {
    const appA = createHumanPromptStore()
    const appB = createHumanPromptStore()

    void appA.getState().request(view, 'shared-id')
    void appB.getState().request(view, 'shared-id')

    expect(appA.getState().queue).toHaveLength(1)
    expect(appB.getState().queue).toHaveLength(1)
    // Not the same entry: identical conversation ids used to be enough for one
    // app's reset to settle the other's prompt.
    expect(appA.getState().queue[0]).not.toBe(appB.getState().queue[0])
  })

  it('settles nothing in another app, even for an identical conversation id', async () => {
    const appA = createHumanPromptStore()
    const appB = createHumanPromptStore()

    const promptA = appA.getState().request(view, 'same-conversation-id')
    const promptB = appB.getState().request(view, 'same-conversation-id')

    appA.getState().reset('same-conversation-id')

    await expect(promptA).resolves.toEqual({ kind: 'dismissed' })
    await expect(settlementOf(promptB)).resolves.toBe(pendingSentinel)
    expect(appB.getState().queue).toHaveLength(1)
  })

  it('an unscoped reset clears only its own app’s queue', async () => {
    const appA = createHumanPromptStore()
    const appB = createHumanPromptStore()

    const promptA = appA.getState().request(view)
    const promptB = appB.getState().request(view)

    // The pre-hydration abort path: "settle everything" has never meant every
    // app in the document, and since #489 it cannot.
    appA.getState().reset()

    await expect(promptA).resolves.toEqual({ kind: 'dismissed' })
    await expect(settlementOf(promptB)).resolves.toBe(pendingSentinel)
    expect(appA.getState().queue).toHaveLength(0)
    expect(appB.getState().queue).toHaveLength(1)
  })
})
