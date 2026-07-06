import { describe, expect, it } from 'vitest'
import { createEvent } from '../src/events/create-event'

describe('createEvent', () => {
  it('stamps strictly increasing seq across consecutive calls', () => {
    const first = createEvent('user.message', { text: 'one' })
    const second = createEvent('user.message', { text: 'two' })
    const third = createEvent('user.message', { text: 'three' })

    for (const event of [first, second, third]) {
      expect(Number.isInteger(event.seq)).toBe(true)
      expect(event.seq).toBeGreaterThanOrEqual(0)
    }
    // Strictly increasing even when timestamps collide at ms resolution — this
    // is what lets replay disambiguate same-millisecond events (issue #333).
    expect(second.seq ?? Number.NaN).toBeGreaterThan(first.seq ?? Number.NaN)
    expect(third.seq ?? Number.NaN).toBeGreaterThan(second.seq ?? Number.NaN)
  })
})
