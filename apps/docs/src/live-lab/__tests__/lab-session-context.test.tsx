import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  LabSessionContext,
  useLabSession,
  type LabSessionContextValue
} from '../lab-session-context'

describe('useLabSession', () => {
  it('throws a helpful error outside a <LiveLab> boundary', () => {
    expect(() => renderHook(() => useLabSession())).toThrow(/must be used within a <LiveLab>/)
  })

  it('returns the provided session value inside a <LiveLab> boundary', () => {
    const value: LabSessionContextValue = {
      snapshot: { status: 'ready', error: null, retryAt: null },
      signIn: vi.fn(),
      reset: vi.fn()
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LabSessionContext.Provider value={value}>{children}</LabSessionContext.Provider>
    )
    const { result } = renderHook(() => useLabSession(), { wrapper })
    expect(result.current).toBe(value)
  })
})
