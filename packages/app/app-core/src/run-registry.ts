// The run-latch protocol (issue #430 review — architecture hardening): the
// pre-hydration '' placeholder run key, the re-key-on-resolve rule, the
// release-by-identity scan, and the MAX_CONCURRENT_RUNS cap arithmetic used to
// be split across two packages that had to change in lockstep — app-browser's
// chat store (the `activeRuns` Map + latch/cap checks + a finally-block scan)
// and this package's `sendConversationPromptAction` (the mid-flight re-key) —
// held together only by comments. `ConversationRunRegistry` is the single
// owner now: the store keeps one instance in its closure and every other
// piece of code touches runs only through its methods.
//
// Deliberately its OWN file, importing nothing else from this package: the
// store needs an instance synchronously, before its first `await` (the #334
// re-entrant-send latch only works if the check happens before any async
// module loading), so this is a real — not lazily `import()`-ed — dependency
// of every shell's tightly-budgeted entry chunk. Keeping it free of chat.ts's
// heavier transitive dependencies (history/projections/ports) keeps that
// entry-chunk cost to just this file.

// Client-side cap on parallel runs (issue #430): a send that would start a run
// beyond this many concurrently running/mid-send conversations is refused
// (surfaces show a visible refusal notice rather than silently queueing). The
// cap counts running AND mid-send conversations — a registry entry exists for
// the entire latch duration, not only once a controller is attached.
export const MAX_CONCURRENT_RUNS = 3

// One in-flight (or mid-send, issue #334) run's mutable handle. The
// `AbortController` is attached only after the pre-run awaits resolve — there
// is nothing to abort before then.
export type ConversationRunHandle = {
  controller?: AbortController
}

export class ConversationRunRegistry {
  private readonly runs = new Map<string, ConversationRunHandle>()
  private readonly cap: number

  constructor(cap: number = MAX_CONCURRENT_RUNS) {
    this.cap = cap
  }

  /** True while `key` currently holds a run — the #334 re-entrant-send latch. */
  has(key: string): boolean {
    return this.runs.has(key)
  }

  /** Number of runs currently tracked (running + mid-send). */
  get size(): number {
    return this.runs.size
  }

  /**
   * Synchronously latch `runKey` for a new run. Returns `undefined` — refuse
   * the send — when `runKey` is already latched (issue #334) OR the registry
   * is already at cap (issue #430); otherwise creates, stores, and returns the
   * handle the caller must eventually pass to {@link release}.
   */
  tryAcquire(runKey: string): ConversationRunHandle | undefined {
    if (this.runs.has(runKey) || this.runs.size >= this.cap) {
      return undefined
    }
    const handle: ConversationRunHandle = {}
    this.runs.set(runKey, handle)
    return handle
  }

  /**
   * Re-point a pre-hydration placeholder latch (`''`) at the conversation id
   * it resolved to (issue #334), so a later send into that SAME conversation
   * hits the latch too. A no-op (returns `true`) when `handle` is already
   * keyed at `conversationId`, or is no longer registered at all (e.g.
   * already released). Returns `false` — the collision-yield case — when
   * `conversationId` is ALREADY held by a DIFFERENT run (another send raced
   * ahead and latched the real id first); the caller must then abandon this
   * run rather than clobber the existing one.
   */
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

  /**
   * Release whichever key currently holds `handle` (it may have been
   * re-keyed since it was acquired, via {@link rekey}). No-op if `handle` is
   * not found (e.g. released twice, or never acquired).
   */
  release(handle: ConversationRunHandle): void {
    for (const [key, value] of this.runs) {
      if (value === handle) {
        this.runs.delete(key)
        return
      }
    }
  }

  /** Abort the run latched under `key`, if any and if it has a controller. */
  abort(key: string): void {
    this.runs.get(key)?.controller?.abort()
  }
}
