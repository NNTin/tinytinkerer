import { describe, expect, it } from 'vitest'
import { parseRetryAfterMs } from '../src'

describe('parseRetryAfterMs', () => {
  it('parses retry-after seconds', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000)
  })

  it('parses retry-after http dates', () => {
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT', Date.parse('Wed, 21 Oct 2015 07:27:00 GMT'))).toBe(
      60_000
    )
  })

  it('clamps elapsed retry-after dates to zero', () => {
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:26:00 GMT', Date.parse('Wed, 21 Oct 2015 07:27:00 GMT'))).toBe(0)
  })

  it('returns undefined for invalid or missing values', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined()
    expect(parseRetryAfterMs('later')).toBeUndefined()
  })
})
