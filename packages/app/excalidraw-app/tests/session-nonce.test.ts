import { describe, expect, it } from 'vitest'
import { readSessionNonce } from '../src/session-nonce'

describe('Excalidraw app session nonce', () => {
  it('reads and decodes the harness nonce from the URL fragment', () => {
    expect(readSessionNonce('#app-bridge-nonce=session%20123')).toBe('session 123')
  })

  it('rejects missing or empty nonce values', () => {
    expect(readSessionNonce('')).toBeNull()
    expect(readSessionNonce('#app-bridge-nonce=')).toBeNull()
  })
})
