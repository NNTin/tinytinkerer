/**
 * A Map whose entries carry an expiry timestamp and are actively evicted
 * (issue #343).
 *
 * The per-isolate in-memory mirrors in ./inbound-rate-limit and
 * ./caller-validation-cache used to skip expired entries on read but never
 * delete them. Cloudflare isolates are long-lived and the key space is
 * unbounded (one entry per unique credential hash or client IP), so an
 * IP-diverse flood on the unauthenticated auth route grew the abuse brake's
 * own memory monotonically. This class bounds that with two-pronged eviction:
 *
 * 1. Delete-on-expired-read: {@link get} removes an entry it finds expired, so
 *    hot keys never linger past their window.
 * 2. Amortized sweep-on-write: every {@link SWEEP_EVERY_N_SETS}th {@link set}
 *    walks all entries and deletes the expired ones, so keys that are never
 *    read again (the flood case) still get reclaimed. Between sweeps the map
 *    holds at most SWEEP_EVERY_N_SETS - 1 dead entries on top of the live ones.
 *
 * Both operations take an explicit `nowMs` rather than calling Date.now(), so
 * callers keep one consistent clock per request and tests stay deterministic
 * with synthetic timestamps.
 */

/** Sets between full sweeps: O(1) amortized cost, bounded dead-entry backlog. */
export const SWEEP_EVERY_N_SETS = 64

type Entry<V> = { value: V; expiresAtMs: number }

export class ExpiringMap<K, V> {
  private readonly entries = new Map<K, Entry<V>>()
  private setsSinceSweep = 0

  /** The value for `key` if it has not expired; an expired entry is deleted. */
  get(key: K, nowMs: number): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAtMs <= nowMs) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  /** Store `value` until `expiresAtMs`, sweeping expired entries every Nth call. */
  set(key: K, value: V, expiresAtMs: number, nowMs: number): void {
    this.entries.set(key, { value, expiresAtMs })
    this.setsSinceSweep += 1
    if (this.setsSinceSweep >= SWEEP_EVERY_N_SETS) {
      this.setsSinceSweep = 0
      for (const [candidate, entry] of this.entries) {
        if (entry.expiresAtMs <= nowMs) this.entries.delete(candidate)
      }
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
    this.setsSinceSweep = 0
  }

  /** Live + not-yet-swept entry count (tests observe eviction through this). */
  get size(): number {
    return this.entries.size
  }
}
