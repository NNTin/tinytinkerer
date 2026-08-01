/**
 * The single authority on whether the assistant is open or minimized (issue
 * #480), and the only thing that decides whether a returning reader downloads the
 * runtime during page load.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY } from '../assistant-constants'

const load = async () => {
  const module = await import('../assistant-presentation')
  module.resetDocsAssistantPresentationForTests()
  return module
}

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
})

describe('a new visitor', () => {
  it('starts minimized, which is what keeps the runtime undownloaded', async () => {
    const { readDocsAssistantPresentation } = await load()

    expect(readDocsAssistantPresentation()).toEqual({
      presentation: 'minimized',
      focusPanelOnMount: false
    })
  })
})

describe('persistence', () => {
  it('remembers an open panel across a reload', async () => {
    const { openDocsAssistant } = await load()
    openDocsAssistant()

    // A fresh module graph is what a reload looks like from here.
    vi.resetModules()
    const { readDocsAssistantPresentation } = await load()
    expect(readDocsAssistantPresentation().presentation).toBe('open')
  })

  it('remembers a minimized panel across a reload', async () => {
    const { openDocsAssistant, setDocsAssistantMinimized } = await load()
    openDocsAssistant()
    setDocsAssistantMinimized(true)

    vi.resetModules()
    const { readDocsAssistantPresentation } = await load()
    expect(readDocsAssistantPresentation().presentation).toBe('minimized')
  })

  it('writes a versioned value', async () => {
    const { openDocsAssistant } = await load()
    openDocsAssistant()

    expect(
      JSON.parse(window.localStorage.getItem(DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY) ?? 'null')
    ).toEqual({ version: 1, presentation: 'open' })
  })

  it.each([
    ['corrupt JSON', 'not json at all'],
    ['a future version', JSON.stringify({ version: 99, presentation: 'open' })],
    ['an unknown presentation', JSON.stringify({ version: 1, presentation: 'docked' })],
    ['a non-object', JSON.stringify(42)]
  ])('falls back to minimized for %s', async (_label, stored) => {
    window.localStorage.setItem(DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY, stored)
    const { readDocsAssistantPresentation } = await load()

    // The conservative direction in every case: a launcher, and no runtime.
    expect(readDocsAssistantPresentation().presentation).toBe('minimized')
  })

  it('survives storage being unavailable', async () => {
    // Private browsing, a full quota, a blocked origin — none of which should
    // stop the assistant from working, only from being remembered.
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })

    const { openDocsAssistant, readDocsAssistantPresentation } = await load()
    expect(readDocsAssistantPresentation().presentation).toBe('minimized')
    expect(() => {
      openDocsAssistant()
    }).not.toThrow()
    expect(readDocsAssistantPresentation().presentation).toBe('open')

    getItem.mockRestore()
    setItem.mockRestore()
  })
})

describe('focus intent', () => {
  it('is set when the reader opens the assistant themselves', async () => {
    const { openDocsAssistant, readDocsAssistantPresentation } = await load()
    openDocsAssistant()

    expect(readDocsAssistantPresentation().focusPanelOnMount).toBe(true)
  })

  it('is NOT set for a returning reader whose open panel is restored', async () => {
    const { openDocsAssistant } = await load()
    openDocsAssistant()

    vi.resetModules()
    const { readDocsAssistantPresentation } = await load()
    // The panel comes back, but focus stays where the reader put it — this is a
    // page load, not a request to start typing.
    expect(readDocsAssistantPresentation()).toEqual({
      presentation: 'open',
      focusPanelOnMount: false
    })
  })

  it('is not set by the widget"s own restore, which FloatingLayout already handles', async () => {
    const { setDocsAssistantMinimized, readDocsAssistantPresentation } = await load()
    setDocsAssistantMinimized(false)

    expect(readDocsAssistantPresentation()).toEqual({
      presentation: 'open',
      focusPanelOnMount: false
    })
  })
})

describe('the snapshot', () => {
  it('is a new object on a change and the same one on a no-op write', async () => {
    // `useSyncExternalStore` compares snapshots by identity, so a write that
    // changed nothing but still allocated would re-render every consumer on
    // every call — and a change that reused the object would render none.
    const { setDocsAssistantMinimized, readDocsAssistantPresentation } = await load()

    const initial = readDocsAssistantPresentation()
    setDocsAssistantMinimized(false)
    const opened = readDocsAssistantPresentation()
    expect(opened).not.toBe(initial)

    setDocsAssistantMinimized(false)
    expect(readDocsAssistantPresentation()).toBe(opened)
  })
})
