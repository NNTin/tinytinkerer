/**
 * The sidebar Office's collapse preference (issue #472).
 *
 * Small, but it is the one piece of this feature that has to survive a reload
 * and a route change, and the one that must not throw where storage is denied —
 * a documentation sidebar that crashed in a locked-down browser would take the
 * navigation with it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

const load = async () => ({
  ...(await import('../assistant-constants')),
  ...(await import('../office-collapse'))
})

describe('docs assistant office collapse', () => {
  it('starts expanded and persists a collapse', async () => {
    const {
      setDocsAssistantOfficeCollapsed,
      DOCS_ASSISTANT_OFFICE_COLLAPSED_STORAGE_KEY,
      useDocsAssistantOfficeCollapsed
    } = await load()
    const { renderHook } = await import('@testing-library/react')

    const { result, rerender } = renderHook(() => useDocsAssistantOfficeCollapsed())
    expect(result.current).toBe(false)

    setDocsAssistantOfficeCollapsed(true)
    rerender()

    expect(result.current).toBe(true)
    expect(window.localStorage.getItem(DOCS_ASSISTANT_OFFICE_COLLAPSED_STORAGE_KEY)).toBe('true')
  })

  it('reads a stored preference on the next visit', async () => {
    const { DOCS_ASSISTANT_OFFICE_COLLAPSED_STORAGE_KEY } = await import('../assistant-constants')
    window.localStorage.setItem(DOCS_ASSISTANT_OFFICE_COLLAPSED_STORAGE_KEY, 'true')

    const { useDocsAssistantOfficeCollapsed } = await load()
    const { renderHook } = await import('@testing-library/react')

    expect(renderHook(() => useDocsAssistantOfficeCollapsed()).result.current).toBe(true)
  })

  it('stays usable when storage is denied', async () => {
    // Private mode, blocked cookies: reading and writing both throw. The
    // preference then holds for the session and simply does not survive a
    // reload, which is better than a sidebar that fails to render.
    const denied = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      }
    }
    vi.stubGlobal('localStorage', denied)

    const { setDocsAssistantOfficeCollapsed, useDocsAssistantOfficeCollapsed } = await load()
    const { renderHook } = await import('@testing-library/react')

    const { result, rerender } = renderHook(() => useDocsAssistantOfficeCollapsed())
    expect(result.current).toBe(false)

    expect(() => setDocsAssistantOfficeCollapsed(true)).not.toThrow()
    rerender()
    expect(result.current).toBe(true)
  })
})
