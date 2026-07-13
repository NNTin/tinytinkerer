// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readAppSnapshot, writeAppSnapshot } from '../src/snapshot-storage'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('snapshot storage', () => {
  it('round-trips an opaque snapshot blob', () => {
    writeAppSnapshot('key', { version: 1, elements: [{ id: 'a' }] })
    expect(readAppSnapshot('key')).toEqual({ version: 1, elements: [{ id: 'a' }] })
  })

  it('returns null for a missing key', () => {
    expect(readAppSnapshot('absent')).toBeNull()
  })

  it('fails safe to null on corrupt JSON instead of throwing', () => {
    window.localStorage.setItem('key', '{not json')
    expect(readAppSnapshot('key')).toBeNull()
  })

  it('swallows write failures (e.g. quota/unavailable storage)', () => {
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeAppSnapshot('key', { a: 1 })).not.toThrow()
  })

  it('fails safe to null when reading throws', () => {
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(readAppSnapshot('key')).toBeNull()
  })
})
