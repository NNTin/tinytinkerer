import { describe, expect, it } from 'vitest'
import { deriveLabSessionSnapshot } from '../lab-session-context'

const base = {
  isResetting: false,
  isCoolingDown: false,
  cooldownUntil: null as string | null,
  isRunning: false,
  token: null as string | null
}

describe('deriveLabSessionSnapshot', () => {
  it('is signed-out with no token', () => {
    expect(deriveLabSessionSnapshot({ ...base }).status).toBe('signed-out')
  })

  it('is ready once a token is present and nothing else is happening', () => {
    expect(deriveLabSessionSnapshot({ ...base, token: 'abc' }).status).toBe('ready')
  })

  it('is running while a call is in flight, even if signed in', () => {
    expect(deriveLabSessionSnapshot({ ...base, token: 'abc', isRunning: true }).status).toBe(
      'running'
    )
  })

  it('is rate-limited during a cooldown and carries retryAt through', () => {
    const retryAt = new Date().toISOString()
    const snapshot = deriveLabSessionSnapshot({
      ...base,
      token: 'abc',
      isCoolingDown: true,
      cooldownUntil: retryAt
    })
    expect(snapshot).toEqual({ status: 'rate-limited', error: null, retryAt })
  })

  it('reset takes precedence over every other condition', () => {
    const snapshot = deriveLabSessionSnapshot({
      isResetting: true,
      isCoolingDown: true,
      cooldownUntil: new Date().toISOString(),
      isRunning: true,
      token: 'abc'
    })
    expect(snapshot.status).toBe('reset')
  })

  it('a cooldown takes precedence over isRunning', () => {
    const snapshot = deriveLabSessionSnapshot({
      ...base,
      token: 'abc',
      isRunning: true,
      isCoolingDown: true,
      cooldownUntil: new Date().toISOString()
    })
    expect(snapshot.status).toBe('rate-limited')
  })
})
