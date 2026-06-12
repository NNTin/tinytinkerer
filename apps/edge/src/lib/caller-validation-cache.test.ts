import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearCallerValidationCache,
  readCachedCallerValidation,
  writeCachedCallerValidation
} from './caller-validation-cache.js'
import { SHARED_CREDENTIAL_KEY } from './rate-limit.js'
import { makeCacheMock } from '../test/cache-mock.js'

const CREDENTIAL_KEY = 'a'.repeat(32)
const IDENTITY = { id: '12345', login: 'nntin' }

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
