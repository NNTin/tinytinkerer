import { describe, expect, it } from 'vitest'
import { ConversationRunRegistry, MAX_CONCURRENT_RUNS } from '../src/run-registry.js'

describe('ConversationRunRegistry (issue #430 review: single owner of the run-latch protocol)', () => {
  describe('tryAcquire', () => {
    it('acquires a fresh key and reports it as held', () => {
      const registry = new ConversationRunRegistry(3)

      const handle = registry.tryAcquire('a')

      expect(handle).toBeDefined()
      expect(registry.has('a')).toBe(true)
      expect(registry.size).toBe(1)
    })

    it('refuses re-entry on an already-latched key (issue #334)', () => {
      const registry = new ConversationRunRegistry(3)
      registry.tryAcquire('a')

      expect(registry.tryAcquire('a')).toBeUndefined()
      expect(registry.size).toBe(1)
    })

    it('allows the pre-hydration placeholder key alongside real conversation ids', () => {
      const registry = new ConversationRunRegistry(3)

      const placeholder = registry.tryAcquire('')
      const real = registry.tryAcquire('conv-1')

      expect(placeholder).toBeDefined()
      expect(real).toBeDefined()
      expect(registry.size).toBe(2)
    })

    it('refuses a new run once at cap, but does not disturb existing holders', () => {
      const registry = new ConversationRunRegistry(2)
      registry.tryAcquire('a')
      registry.tryAcquire('b')

      expect(registry.tryAcquire('c')).toBeUndefined()
      expect(registry.size).toBe(2)
      expect(registry.has('a')).toBe(true)
      expect(registry.has('b')).toBe(true)
    })

    it('defaults the cap to MAX_CONCURRENT_RUNS when none is supplied', () => {
      const registry = new ConversationRunRegistry()
      for (let i = 0; i < MAX_CONCURRENT_RUNS; i += 1) {
        expect(registry.tryAcquire(`c${i}`)).toBeDefined()
      }
      expect(registry.tryAcquire('overflow')).toBeUndefined()
    })

    it('frees a cap slot after release, admitting a new run', () => {
      const registry = new ConversationRunRegistry(1)
      const handle = registry.tryAcquire('a')
      expect(handle).toBeDefined()
      expect(registry.tryAcquire('b')).toBeUndefined()

      registry.release(handle!)

      expect(registry.tryAcquire('b')).toBeDefined()
    })
  })

  describe('rekey', () => {
    it('re-points a placeholder latch onto the resolved conversation id', () => {
      const registry = new ConversationRunRegistry(3)
      const handle = registry.tryAcquire('')!

      const ok = registry.rekey(handle, 'conv-1')

      expect(ok).toBe(true)
      expect(registry.has('')).toBe(false)
      expect(registry.has('conv-1')).toBe(true)
      expect(registry.size).toBe(1)
    })

    it('is a no-op returning true when the handle is already keyed at the target', () => {
      const registry = new ConversationRunRegistry(3)
      const handle = registry.tryAcquire('conv-1')!

      const ok = registry.rekey(handle, 'conv-1')

      expect(ok).toBe(true)
      expect(registry.has('conv-1')).toBe(true)
      expect(registry.size).toBe(1)
    })

    it('is a no-op returning true for a handle that is no longer registered', () => {
      const registry = new ConversationRunRegistry(3)
      const handle = registry.tryAcquire('a')!
      registry.release(handle)

      expect(registry.rekey(handle, 'b')).toBe(true)
      expect(registry.has('b')).toBe(false)
      expect(registry.size).toBe(0)
    })

    it('returns false (the collision-yield case) when the target key is already held by a different run', () => {
      const registry = new ConversationRunRegistry(3)
      const placeholder = registry.tryAcquire('')!
      // Another send raced ahead and latched the real id directly.
      registry.tryAcquire('conv-1')

      const ok = registry.rekey(placeholder, 'conv-1')

      expect(ok).toBe(false)
      // Neither entry was disturbed by the failed rekey.
      expect(registry.has('')).toBe(true)
      expect(registry.has('conv-1')).toBe(true)
      expect(registry.size).toBe(2)
    })
  })

  describe('release', () => {
    it('releases whichever key currently holds the handle, even after a rekey', () => {
      const registry = new ConversationRunRegistry(3)
      const handle = registry.tryAcquire('')!
      registry.rekey(handle, 'conv-1')

      registry.release(handle)

      expect(registry.has('conv-1')).toBe(false)
      expect(registry.size).toBe(0)
    })

    it('is a no-op for a handle that is not registered (e.g. released twice)', () => {
      const registry = new ConversationRunRegistry(3)
      const handle = registry.tryAcquire('a')!
      registry.release(handle)

      expect(() => registry.release(handle)).not.toThrow()
      expect(registry.size).toBe(0)
    })
  })

  describe('abort', () => {
    it('aborts the controller attached to the run latched under a key', () => {
      const registry = new ConversationRunRegistry(3)
      const handle = registry.tryAcquire('conv-1')!
      const controller = new AbortController()
      handle.controller = controller

      registry.abort('conv-1')

      expect(controller.signal.aborted).toBe(true)
    })

    it('is a no-op for an unknown key', () => {
      const registry = new ConversationRunRegistry(3)
      expect(() => registry.abort('ghost')).not.toThrow()
    })

    it('is a no-op for a key with no controller attached yet (pre-run-start)', () => {
      const registry = new ConversationRunRegistry(3)
      registry.tryAcquire('conv-1')
      expect(() => registry.abort('conv-1')).not.toThrow()
    })
  })
})
