import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearCallerValidationCache,
  readCachedCallerValidation,
  writeCachedCallerValidation
} from './caller-validation-cache.js'
import { SHARED_CREDENTIAL_KEY } from './rate-limit.js'
import { makeCacheMock } from '../test/cache-mock.js'

const CREDENTIAL_KEY = 'a'.repeat(32)
const OTHER_CREDENTIAL_KEY = 'b'.repeat(32)
const IDENTITY = { id: '12345', login: 'nntin' }
const OTHER_IDENTITY = { id: '67890', login: 'other-user' }

describe('caller-validation-cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearCallerValidationCache()
  })

  // The shared bucket means "we could not hash the credential": caching under
  // it would validate every caller off one token, so both directions must be
  // dead ends.
  it('never serves a validation for the shared credential key', async () => {
    await expect(
      readCachedCallerValidation(SHARED_CREDENTIAL_KEY)
    ).resolves.toBeUndefined()

    await writeCachedCallerValidation(SHARED_CREDENTIAL_KEY, IDENTITY)

    await expect(
      readCachedCallerValidation(SHARED_CREDENTIAL_KEY)
    ).resolves.toBeUndefined()
  })

  it('does not touch the durable cache when writing the shared credential key', async () => {
    const { store, cache } = makeCacheMock()
    const putSpy = vi.spyOn(cache, 'put')
    vi.stubGlobal('caches', { default: cache })

    await writeCachedCallerValidation(SHARED_CREDENTIAL_KEY, IDENTITY)

    expect(putSpy).not.toHaveBeenCalled()
    expect(store.size).toBe(0)
  })

  it('serves a written validation within the TTL and rejects unknown credentials', async () => {
    await writeCachedCallerValidation(CREDENTIAL_KEY, IDENTITY)

    await expect(readCachedCallerValidation(CREDENTIAL_KEY)).resolves.toEqual(
      IDENTITY
    )
    await expect(readCachedCallerValidation('b'.repeat(32))).resolves.toBe(
      undefined
    )
  })

  // The whole point of caching identity is per-user budgets: a validation cached
  // under one credential must NEVER be served for another. A regression here
  // would let one GitHub user borrow another's minted LiteLLM key + budget.
  it('keeps each credential’s identity isolated (in-memory mirror)', async () => {
    await writeCachedCallerValidation(CREDENTIAL_KEY, IDENTITY)
    await writeCachedCallerValidation(OTHER_CREDENTIAL_KEY, OTHER_IDENTITY)

    await expect(readCachedCallerValidation(CREDENTIAL_KEY)).resolves.toEqual(
      IDENTITY
    )
    await expect(
      readCachedCallerValidation(OTHER_CREDENTIAL_KEY)
    ).resolves.toEqual(OTHER_IDENTITY)
  })

  it('keeps each credential’s identity isolated across the durable cache (fresh isolate)', async () => {
    const { cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })

    await writeCachedCallerValidation(CREDENTIAL_KEY, IDENTITY)
    await writeCachedCallerValidation(OTHER_CREDENTIAL_KEY, OTHER_IDENTITY)
    // Drop the in-memory mirror so both reads come from the durable layer.
    clearCallerValidationCache()

    await expect(readCachedCallerValidation(CREDENTIAL_KEY)).resolves.toEqual(
      IDENTITY
    )
    await expect(
      readCachedCallerValidation(OTHER_CREDENTIAL_KEY)
    ).resolves.toEqual(OTHER_IDENTITY)
  })

  // A durable entry that survived a schema change (or was written by an older
  // build) may lack id/login. Serving a partial identity would resolve a
  // `github-undefined` LiteLLM key, so it must be treated as a miss and re-probed.
  it('treats a durable entry missing id/login as a miss', async () => {
    const { store, cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })

    // Hand-craft a malformed durable entry with a valid (future) until-stamp.
    const untilMs = Date.now() + 5 * 60_000
    store.set(
      'https://caller-validation-cache.tiny.nntin.xyz/github/' + CREDENTIAL_KEY,
      new Response(JSON.stringify({ login: 'nntin' }), {
        headers: { 'x-caller-validated-until': String(untilMs) }
      })
    )

    await expect(
      readCachedCallerValidation(CREDENTIAL_KEY)
    ).resolves.toBeUndefined()
  })

  it('reads a durable Cache-API entry on an in-memory miss (fresh isolate)', async () => {
    const { cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })

    await writeCachedCallerValidation(CREDENTIAL_KEY, IDENTITY)
    // Simulate a fresh isolate: the in-memory mirror is gone but the durable
    // colo-wide entry survives.
    clearCallerValidationCache()

    await expect(readCachedCallerValidation(CREDENTIAL_KEY)).resolves.toEqual(
      IDENTITY
    )
  })

  it('treats an expired durable entry as a miss', async () => {
    const { cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })

    const writtenAtMs = Date.now()
    await writeCachedCallerValidation(CREDENTIAL_KEY, IDENTITY, writtenAtMs)
    clearCallerValidationCache()

    // Read past the 5-minute TTL: the validated-until stamp has elapsed.
    await expect(
      readCachedCallerValidation(CREDENTIAL_KEY, writtenAtMs + 6 * 60_000)
    ).resolves.toBeUndefined()
  })

  it('returns false on an in-memory miss when no durable cache exists (vitest/Node)', async () => {
    await writeCachedCallerValidation(CREDENTIAL_KEY, IDENTITY)
    clearCallerValidationCache()

    await expect(readCachedCallerValidation(CREDENTIAL_KEY)).resolves.toBe(
      undefined
    )
  })
})
