// Entry-safe duplicate of `@tinytinkerer/app-core`'s `ConversationRunRegistry`
// and `MAX_CONCURRENT_RUNS` (issue #441). chat-store.ts needs an instance
// synchronously, before its first `await` (the #334 re-entrant-send latch only
// works if the check happens before any async module loading) — see the
// canonical run-registry.ts's header in app-core for the full protocol
// rationale. That makes this a real, non-lazy dependency of every shell's
// entry chunk, so it cannot come from a static VALUE import of
// `@tinytinkerer/app-core`: that package is bucketed with agent-core and
// contracts into one ~123 kB manualChunks output (see
// scripts/browser-shell-chunks.mjs), and any static edge into it drags the
// whole merged chunk onto the entry's static graph — the exact chunk
// `loadCoreModule()` elsewhere loads lazily.
//
// Keep this logic identical to packages/app/app-core/src/run-registry.ts;
// run-registry.test.ts asserts the two never drift.
export const MAX_CONCURRENT_RUNS = 3

export type ConversationRunHandle = {
  controller?: AbortController
}

export class ConversationRunRegistry {
  private readonly runs = new Map<string, ConversationRunHandle>()
  private readonly cap: number

  constructor(cap: number = MAX_CONCURRENT_RUNS) {
    this.cap = cap
  }

  has(key: string): boolean {
    return this.runs.has(key)
  }

  get size(): number {
    return this.runs.size
  }

  tryAcquire(runKey: string): ConversationRunHandle | undefined {
    if (this.runs.has(runKey) || this.runs.size >= this.cap) {
      return undefined
    }
    const handle: ConversationRunHandle = {}
    this.runs.set(runKey, handle)
    return handle
  }

  rekey(handle: ConversationRunHandle, conversationId: string): boolean {
    let fromKey: string | undefined
    for (const [key, value] of this.runs) {
      if (value === handle) {
        fromKey = key
        break
      }
    }
    if (fromKey === undefined || fromKey === conversationId) {
      return true
    }
    if (this.runs.has(conversationId)) {
      return false
    }
    this.runs.delete(fromKey)
    this.runs.set(conversationId, handle)
    return true
  }

  // Returns the key the handle was registered under, so a caller that has to
  // clean up after the run — settling a human prompt the run left queued, say —
  // knows WHICH conversation it just finished. That is not always the id the
  // caller started with: a pre-hydration send latches on the '' placeholder and
  // is re-keyed once the conversation resolves. `undefined` for a handle that
  // was already released.
  release(handle: ConversationRunHandle): string | undefined {
    for (const [key, value] of this.runs) {
      if (value === handle) {
        this.runs.delete(key)
        return key
      }
    }
  }

  abort(key: string): void {
    this.runs.get(key)?.controller?.abort()
  }
}
