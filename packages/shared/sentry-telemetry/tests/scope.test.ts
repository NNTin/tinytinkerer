import { describe, expect, it, vi } from 'vitest'
import type { Scope } from '@sentry/core'

import { applyCaptureOptionsToScope } from '../src/scope.js'

const createScope = () => {
  const setLevel = vi.fn()
  const setTag = vi.fn()
  const setContext = vi.fn()
  const setFingerprint = vi.fn()
  const scope = { setLevel, setTag, setContext, setFingerprint } as unknown as Scope
  return { scope, setLevel, setTag, setContext, setFingerprint }
}

describe('applyCaptureOptionsToScope', () => {
  it('sets the level when present', () => {
    const { scope, setLevel } = createScope()
    applyCaptureOptionsToScope(scope, { level: 'warning' })
    expect(setLevel).toHaveBeenCalledWith('warning')
  })

  it('does not call setLevel when level is absent', () => {
    const { scope, setLevel } = createScope()
    applyCaptureOptionsToScope(scope, {})
    expect(setLevel).not.toHaveBeenCalled()
  })

  it('coerces tag values to strings and skips undefined entries', () => {
    const { scope, setTag } = createScope()
    applyCaptureOptionsToScope(scope, {
      tags: { area: 'models', status: 429, retryable: true, skipped: undefined }
    })
    expect(setTag).toHaveBeenCalledTimes(3)
    expect(setTag).toHaveBeenCalledWith('area', 'models')
    expect(setTag).toHaveBeenCalledWith('status', '429')
    expect(setTag).toHaveBeenCalledWith('retryable', 'true')
    expect(setTag).not.toHaveBeenCalledWith('skipped', expect.anything())
  })

  it('passes each context entry through to setContext unchanged', () => {
    const { scope, setContext } = createScope()
    applyCaptureOptionsToScope(scope, {
      contexts: { request: { url: '/api/models', status: 429 } }
    })
    expect(setContext).toHaveBeenCalledTimes(1)
    expect(setContext).toHaveBeenCalledWith('request', { url: '/api/models', status: 429 })
  })

  it('sets the fingerprint when present', () => {
    const { scope, setFingerprint } = createScope()
    applyCaptureOptionsToScope(scope, { fingerprint: ['models.list', '429'] })
    expect(setFingerprint).toHaveBeenCalledWith(['models.list', '429'])
  })

  it('does not call setFingerprint when fingerprint is absent', () => {
    const { scope, setFingerprint } = createScope()
    applyCaptureOptionsToScope(scope, {})
    expect(setFingerprint).not.toHaveBeenCalled()
  })

  it('calls no scope method when options are empty', () => {
    const { scope, setLevel, setTag, setContext, setFingerprint } = createScope()
    applyCaptureOptionsToScope(scope, {})
    expect(setLevel).not.toHaveBeenCalled()
    expect(setTag).not.toHaveBeenCalled()
    expect(setContext).not.toHaveBeenCalled()
    expect(setFingerprint).not.toHaveBeenCalled()
  })
})
