import { describe, expect, it } from 'vitest'
import {
  ConversationRunRegistry as CanonicalConversationRunRegistry,
  MAX_CONCURRENT_RUNS as CANONICAL_MAX_CONCURRENT_RUNS
} from '@tinytinkerer/app-core'
import { ConversationRunRegistry, MAX_CONCURRENT_RUNS } from '../src/stores/run-registry.js'

// Guards the intentional duplication in src/stores/run-registry.ts (issue
// #441): that copy exists so chat-store.ts never statically imports a VALUE
// from @tinytinkerer/app-core (which would drag the whole merged
// app-core/agent-core/contracts chunk onto the entry's static graph). This
// test file is not part of the shipped bundle, so it's free to import both
// implementations and assert they agree on the full run-latch protocol.
describe('run-registry entry-safe duplicate', () => {
  it('matches the canonical MAX_CONCURRENT_RUNS', () => {
    expect(MAX_CONCURRENT_RUNS).toBe(CANONICAL_MAX_CONCURRENT_RUNS)
  })

  it.each([
    ['entry-safe duplicate', ConversationRunRegistry],
    ['canonical @tinytinkerer/app-core', CanonicalConversationRunRegistry]
  ] as const)('%s: latches, re-keys, releases, and caps identically', (_label, Registry) => {
    const registry = new Registry(2)
    expect(registry.tryAcquire('')).toBeDefined()
    expect(registry.has('')).toBe(true)
    expect(registry.tryAcquire('')).toBeUndefined()

    const handle = registry.tryAcquire('a')
    expect(handle).toBeDefined()
    expect(registry.size).toBe(2)
    expect(registry.tryAcquire('b')).toBeUndefined()

    expect(registry.rekey(handle!, 'resolved-a')).toBe(true)
    expect(registry.has('a')).toBe(false)
    expect(registry.has('resolved-a')).toBe(true)

    registry.release(handle!)
    expect(registry.has('resolved-a')).toBe(false)
    expect(registry.size).toBe(1)
  })
})
