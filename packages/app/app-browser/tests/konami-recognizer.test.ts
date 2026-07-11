import { describe, expect, it } from 'vitest'
import { createKonamiRecognizer } from '../src/konami/sequence-recognizer.js'
import { KONAMI_SEQUENCE } from '../src/konami/konami-config.js'

describe('createKonamiRecognizer', () => {
  it('fires exactly at the last key of the sequence', () => {
    const recognize = createKonamiRecognizer(KONAMI_SEQUENCE)
    const allButLast = KONAMI_SEQUENCE.slice(0, -1)
    const lastKey = KONAMI_SEQUENCE[KONAMI_SEQUENCE.length - 1]!

    for (const key of allButLast) {
      expect(recognize(key)).toBe(false)
    }
    expect(recognize(lastKey)).toBe(true)
  })

  it('does NOT fire on finishing the remainder after a wrong key mid-sequence', () => {
    const recognize = createKonamiRecognizer(KONAMI_SEQUENCE)

    // Correct start, then a wrong key partway through, then the correct remainder.
    expect(recognize('ArrowUp')).toBe(false)
    expect(recognize('ArrowUp')).toBe(false)
    expect(recognize('x')).toBe(false) // wrong key breaks the run
    for (const key of KONAMI_SEQUENCE.slice(3)) {
      expect(recognize(key)).toBe(false)
    }
  })

  it('fires on full re-entry after a wrong key reset the run', () => {
    const recognize = createKonamiRecognizer(KONAMI_SEQUENCE)

    expect(recognize('ArrowUp')).toBe(false)
    expect(recognize('x')).toBe(false)

    for (const key of KONAMI_SEQUENCE.slice(0, -1)) {
      expect(recognize(key)).toBe(false)
    }
    expect(recognize(KONAMI_SEQUENCE[KONAMI_SEQUENCE.length - 1]!)).toBe(true)
  })

  it('fires on an overlapping prefix (extra leading ArrowUp)', () => {
    const recognize = createKonamiRecognizer(KONAMI_SEQUENCE)
    // Up Up Up Down Down Left Right Left Right b a — the first "Up" is a false
    // start, but the trailing ten keys are exactly KONAMI_SEQUENCE, so this must
    // still fire on the final key.
    const withExtraLeadingUp = ['ArrowUp', ...KONAMI_SEQUENCE]

    const results = withExtraLeadingUp.map((key) => recognize(key))
    expect(results.slice(0, -1)).toEqual(results.slice(0, -1).map(() => false))
    expect(results[results.length - 1]).toBe(true)
  })

  it('is case-insensitive for the single-character B/A keys', () => {
    const recognize = createKonamiRecognizer(KONAMI_SEQUENCE)
    const upperCased = KONAMI_SEQUENCE.map((key) => (key.length === 1 ? key.toUpperCase() : key))

    const results = upperCased.map((key) => recognize(key))
    expect(results[results.length - 1]).toBe(true)
  })

  it('fires again after a second full entry', () => {
    const recognize = createKonamiRecognizer(KONAMI_SEQUENCE)

    for (const key of KONAMI_SEQUENCE) {
      recognize(key)
    }

    const secondRunResults = KONAMI_SEQUENCE.map((key) => recognize(key))
    expect(secondRunResults[secondRunResults.length - 1]).toBe(true)
    expect(secondRunResults.slice(0, -1)).toEqual(secondRunResults.slice(0, -1).map(() => false))
  })
})
