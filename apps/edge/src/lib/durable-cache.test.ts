import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteDurable,
  numericHeader,
  readDurable,
  remainingMaxAgeSeconds,
  writeDurable
} from './durable-cache.js'
import { makeCacheMock } from '../test/cache-mock.js'

describe('durable-cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('without a durable cache (vitest/Node)', () => {
    it('readDurable reports a miss without calling parse', async () => {
      const parse = vi.fn()
      await expect(readDurable('https://example.test/a', parse)).resolves.toBeUndefined()
      expect(parse).not.toHaveBeenCalled()
    })

    it('writeDurable and deleteDurable resolve without throwing', async () => {
      await expect(
        writeDurable('https://example.test/a', { maxAgeSeconds: 60 })
      ).resolves.toBeUndefined()
      await expect(deleteDurable('https://example.test/a')).resolves.toBeUndefined()
    })
  })

  describe('round-trip with a durable cache', () => {
    it('writes cache-control, extra headers, and the body, and reads them back', async () => {
      const { cache } = makeCacheMock()
      vi.stubGlobal('caches', { default: cache })

      await writeDurable('https://example.test/a', {
        maxAgeSeconds: 42,
        headers: { 'x-custom': 'value' },
        body: 'hello'
      })

      const hit = await readDurable('https://example.test/a', async (response) => ({
        cacheControl: response.headers.get('cache-control'),
        custom: response.headers.get('x-custom'),
        body: await response.text()
      }))

      expect(hit).toEqual({ cacheControl: 'max-age=42', custom: 'value', body: 'hello' })
    })

    it('deleteDurable removes a written entry', async () => {
      const { cache } = makeCacheMock()
      vi.stubGlobal('caches', { default: cache })

      await writeDurable('https://example.test/a', { maxAgeSeconds: 42 })
      await deleteDurable('https://example.test/a')

      await expect(readDurable('https://example.test/a', (r) => r.text())).resolves.toBeUndefined()
    })
  })

  it('readDurable returns undefined when parse throws', async () => {
    const { cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })

    await writeDurable('https://example.test/a', { maxAgeSeconds: 42 })

    await expect(
      readDurable('https://example.test/a', () => {
        throw new Error('boom')
      })
    ).resolves.toBeUndefined()
  })

  it('writeDurable is best-effort when the store throws', async () => {
    const store = {
      match: () => Promise.reject(new Error('boom')),
      put: () => Promise.reject(new Error('boom')),
      delete: () => Promise.reject(new Error('boom'))
    }
    vi.stubGlobal('caches', { default: store })

    await expect(
      writeDurable('https://example.test/a', { maxAgeSeconds: 42 })
    ).resolves.toBeUndefined()
  })

  it('deleteDurable is best-effort when the store throws', async () => {
    const store = {
      match: () => Promise.reject(new Error('boom')),
      put: () => Promise.reject(new Error('boom')),
      delete: () => Promise.reject(new Error('boom'))
    }
    vi.stubGlobal('caches', { default: store })

    await expect(deleteDurable('https://example.test/a')).resolves.toBeUndefined()
  })

  it('readDurable returns undefined when the store throws on match', async () => {
    const store = {
      match: () => Promise.reject(new Error('boom')),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(true)
    }
    vi.stubGlobal('caches', { default: store })

    await expect(readDurable('https://example.test/a', (r) => r.text())).resolves.toBeUndefined()
  })

  describe('numericHeader', () => {
    it('returns undefined when the header is missing', () => {
      expect(numericHeader(new Response(''), 'x-missing')).toBeUndefined()
    })

    it('returns undefined for a non-numeric value', () => {
      const response = new Response('', { headers: { 'x-value': 'garbage' } })
      expect(numericHeader(response, 'x-value')).toBeUndefined()
    })

    it('parses a valid numeric value', () => {
      const response = new Response('', { headers: { 'x-value': '123' } })
      expect(numericHeader(response, 'x-value')).toBe(123)
    })
  })

  describe('remainingMaxAgeSeconds', () => {
    it('rounds up to the next whole second', () => {
      expect(remainingMaxAgeSeconds(10_500, 0)).toBe(11)
    })

    it('floors at 1 for an already-elapsed or immediate deadline', () => {
      expect(remainingMaxAgeSeconds(0, 0)).toBe(1)
      expect(remainingMaxAgeSeconds(-5_000, 0)).toBe(1)
    })
  })
})
