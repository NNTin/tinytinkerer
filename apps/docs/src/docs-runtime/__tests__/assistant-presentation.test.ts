/**
 * The single authority on how the assistant is presented — floating or docked,
 * panel or launcher (issue #480) — and the only thing that decides whether a
 * returning reader downloads the runtime during page load.
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
      mode: 'floating',
      minimized: true,
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
    expect(readDocsAssistantPresentation().minimized).toBe(false)
  })

  it('remembers a minimized panel across a reload', async () => {
    const { openDocsAssistant, setDocsAssistantMinimized } = await load()
    openDocsAssistant()
    setDocsAssistantMinimized(true)

    vi.resetModules()
    const { readDocsAssistantPresentation } = await load()
    expect(readDocsAssistantPresentation().minimized).toBe(true)
  })

  it('remembers a DOCKED assistant across a reload', async () => {
    // One record covers both axes, so a reader who docked gets a docked panel
    // back — not a floating one that ChatApp then re-docks a frame later.
    const { openDocsAssistant, setDocsAssistantMode } = await load()
    openDocsAssistant()
    setDocsAssistantMode('sidebar')

    vi.resetModules()
    const { readDocsAssistantPresentation, isDocsAssistantOpen } = await load()
    const restored = readDocsAssistantPresentation()
    expect(restored.mode).toBe('sidebar')
    expect(isDocsAssistantOpen(restored)).toBe(true)
  })

  it('writes a versioned value', async () => {
    const { openDocsAssistant } = await load()
    openDocsAssistant()

    expect(
      JSON.parse(window.localStorage.getItem(DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY) ?? 'null')
    ).toEqual({ version: 2, mode: 'floating', minimized: false })
  })

  it.each([
    ['corrupt JSON', 'not json at all'],
    ['a future version', JSON.stringify({ version: 99, mode: 'floating', minimized: false })],
    [
      'the version-1 record, which is not migrated',
      JSON.stringify({ version: 1, presentation: 'open' })
    ],
    ['a non-object', JSON.stringify(42)]
  ])('falls back to a minimized floating widget for %s', async (_label, stored) => {
    window.localStorage.setItem(DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY, stored)
    const { readDocsAssistantPresentation, isDocsAssistantOpen } = await load()

    // The conservative direction in every case: a launcher, and no runtime.
    const value = readDocsAssistantPresentation()
    expect(value).toMatchObject({ mode: 'floating', minimized: true })
    expect(isDocsAssistantOpen(value)).toBe(false)
  })

  it('reads an unknown mode as floating', async () => {
    window.localStorage.setItem(
      DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY,
      JSON.stringify({ version: 2, mode: 'docked', minimized: false })
    )
    const { readDocsAssistantPresentation } = await load()

    expect(readDocsAssistantPresentation().mode).toBe('floating')
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
    expect(readDocsAssistantPresentation().minimized).toBe(true)
    expect(() => {
      openDocsAssistant()
    }).not.toThrow()
    expect(readDocsAssistantPresentation().minimized).toBe(false)

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
      mode: 'floating',
      minimized: false,
      focusPanelOnMount: false
    })
  })

  it('is not set by the widget"s own restore, which FloatingLayout already handles', async () => {
    const { setDocsAssistantMinimized, readDocsAssistantPresentation } = await load()
    setDocsAssistantMinimized(false)

    expect(readDocsAssistantPresentation()).toEqual({
      mode: 'floating',
      minimized: false,
      focusPanelOnMount: false
    })
  })
})

describe('the mode', () => {
  it('opens the panel when the reader docks a minimized widget', async () => {
    // Docking is a request to see the assistant. Keeping `minimized` set would
    // collapse it the instant they undocked again.
    const { setDocsAssistantMode, readDocsAssistantPresentation, isDocsAssistantOpen } =
      await load()

    setDocsAssistantMode('sidebar')

    const value = readDocsAssistantPresentation()
    expect(value.minimized).toBe(false)
    expect(isDocsAssistantOpen(value)).toBe(true)
  })

  it('keeps `minimized` meaningful only while floating', async () => {
    const { setDocsAssistantMinimized, setDocsAssistantMode, readDocsAssistantPresentation } =
      await load()

    setDocsAssistantMode('sidebar')
    setDocsAssistantMinimized(true)
    // A docked panel has no collapsed state, so the flag is stored but does not
    // hide anything — it is what undocking restores them to.
    const { isDocsAssistantOpen } = await load()
    expect(isDocsAssistantOpen(readDocsAssistantPresentation())).toBe(true)
  })

  it('preserves the mode a reader opened in', async () => {
    const { openDocsAssistant, setDocsAssistantMode, setDocsAssistantMinimized } = await load()
    setDocsAssistantMode('sidebar')
    setDocsAssistantMode('floating')
    setDocsAssistantMinimized(true)
    openDocsAssistant()

    const { readDocsAssistantPresentation } = await load()
    expect(readDocsAssistantPresentation()).toMatchObject({ mode: 'floating', minimized: false })
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
