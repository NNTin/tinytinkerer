import { describe, expect, it } from 'vitest'
import { ExpiringMap, SWEEP_EVERY_N_SETS } from './expiring-map.js'

describe('ExpiringMap', () => {
  it('returns unexpired values and misses on unknown keys', () => {
    const map = new ExpiringMap<string, number>()
    map.set('a', 1, 1_000, 0)

    expect(map.get('a', 999)).toBe(1)
    expect(map.get('missing', 0)).toBeUndefined()
  })

  it('deletes an expired entry on read', () => {
    const map = new ExpiringMap<string, number>()
    map.set('a', 1, 1_000, 0)
    expect(map.size).toBe(1)

    // Expiry is inclusive: an entry is dead exactly at its expiresAtMs.
    expect(map.get('a', 1_000)).toBeUndefined()
    expect(map.size).toBe(0)
  })

  it('sweeps expired entries once the set threshold is crossed', () => {
    const map = new ExpiringMap<string, number>()
    const deadCount = 10
    for (let i = 0; i < deadCount; i++) map.set(`dead-${i}`, i, 1_000, 0)
    expect(map.size).toBe(deadCount)

    // Past the dead entries' expiry, write fresh keys until a sweep must have
    // fired. None of the dead keys is ever read, so only the amortized
    // sweep-on-write can reclaim them.
    for (let i = 0; i < SWEEP_EVERY_N_SETS; i++) map.set(`live-${i}`, i, 10_000, 2_000)
    expect(map.size).toBe(SWEEP_EVERY_N_SETS)
    expect(map.get('dead-0', 0)).toBeUndefined()
    expect(map.get('live-0', 2_000)).toBe(0)
  })

  it('deletes a single entry without touching the rest', () => {
    const map = new ExpiringMap<string, number>()
    map.set('a', 1, 1_000, 0)
    map.set('b', 2, 1_000, 0)

    expect(map.delete('a')).toBe(true)
    expect(map.delete('a')).toBe(false)
    expect(map.size).toBe(1)
    expect(map.get('b', 0)).toBe(2)
  })

  it('clear empties the map', () => {
    const map = new ExpiringMap<string, number>()
    map.set('a', 1, 1_000, 0)
    map.set('b', 2, 1_000, 0)

    map.clear()
    expect(map.size).toBe(0)
    expect(map.get('a', 0)).toBeUndefined()
  })
})
