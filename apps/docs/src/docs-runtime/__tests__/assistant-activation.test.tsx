/**
 * Activation (issue #479) — the light module a launcher (#480) or a sidebar page
 * (#472) may import without pulling the product runtime into its own chunk.
 *
 * The registry lives in assistant-surfaces.test.tsx, where placement is asserted
 * against real renders rather than snapshot shapes.
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

describe('assistant runtime activation', () => {
  it('starts idle, so opening a documentation page fetches no runtime', async () => {
    const { readDocsAssistantRuntimeStatus } = await import('../assistant-activation')
    expect(readDocsAssistantRuntimeStatus()).toBe('idle')
  })

  it('moves to starting on request and notifies subscribers', async () => {
    const { requestDocsAssistantRuntime, useDocsAssistantRuntime } =
      await import('../assistant-activation')
    const { result } = renderHook(() => useDocsAssistantRuntime())

    expect(result.current.status).toBe('idle')
    act(() => {
      result.current.activate()
    })
    expect(result.current.status).toBe('starting')

    // Idempotent: a second click while it boots must not restart anything.
    act(() => {
      requestDocsAssistantRuntime()
    })
    expect(result.current.status).toBe('starting')
  })

  it('does not fall back to starting once the session is ready', async () => {
    const {
      publishDocsAssistantRuntimeStatus,
      requestDocsAssistantRuntime,
      readDocsAssistantRuntimeStatus
    } = await import('../assistant-activation')

    requestDocsAssistantRuntime()
    publishDocsAssistantRuntimeStatus('ready')
    requestDocsAssistantRuntime()

    expect(readDocsAssistantRuntimeStatus()).toBe('ready')
  })

  it('counts a retry as a new attempt, so the host can re-import', async () => {
    const {
      publishDocsAssistantRuntimeStatus,
      requestDocsAssistantRuntime,
      readDocsAssistantRuntimeStatus,
      useDocsAssistantRuntimeActivation
    } = await import('../assistant-activation')
    const { result } = renderHook(() => useDocsAssistantRuntimeActivation())

    act(() => {
      requestDocsAssistantRuntime()
    })
    const first = result.current.attempt

    act(() => {
      publishDocsAssistantRuntimeStatus('error')
    })
    expect(readDocsAssistantRuntimeStatus()).toBe('error')

    act(() => {
      requestDocsAssistantRuntime()
    })
    expect(readDocsAssistantRuntimeStatus()).toBe('starting')
    // The attempt is what makes the retry real: React.lazy memoises its
    // rejection, so the host has to build a fresh payload, and it keys that on
    // this number. A status that advertises a retry must have one — the #476
    // lesson, applied to a chunk load.
    expect(result.current.attempt).toBe(first + 1)
  })

  it('does not advance the attempt when the status merely changes', async () => {
    const {
      publishDocsAssistantRuntimeStatus,
      requestDocsAssistantRuntime,
      useDocsAssistantRuntimeActivation
    } = await import('../assistant-activation')
    const { result } = renderHook(() => useDocsAssistantRuntimeActivation())

    act(() => {
      requestDocsAssistantRuntime()
    })
    const attempt = result.current.attempt

    act(() => {
      publishDocsAssistantRuntimeStatus('ready')
    })
    expect(result.current.attempt).toBe(attempt)
  })
})
