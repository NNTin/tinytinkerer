// @vitest-environment jsdom
/**
 * The shared chat presentation contract (issue #480 re-review, finding 2).
 *
 * Everything an embedder used to reimplement — the mode union, the versioned
 * record, its parser, the transition rules and the store — lives here, so this
 * is where those rules are pinned. `ChatApp`'s own use of them is covered by
 * chat-app.test.tsx, and the documentation assistant's adapter by its own suite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_PRESENTATION_STORAGE_VERSION,
  DEFAULT_CHAT_PRESENTATION,
  createChatPresentationStore,
  isChatPresentationOpen,
  openChatPresentation,
  parseChatPresentation,
  readChatPresentation,
  serializeChatPresentation,
  setChatPresentationMinimized,
  setChatPresentationMode,
  writeChatPresentation,
  type ChatPresentation
} from '../src/chat-presentation.js'

afterEach(() => {
  window.localStorage.clear()
})

const floatingOpen: ChatPresentation = { mode: 'floating', minimized: false, edge: 'right' }

describe('transitions', () => {
  it('opens without changing the mode the reader left it in', () => {
    expect(openChatPresentation({ ...floatingOpen, mode: 'sidebar', minimized: true })).toEqual({
      mode: 'sidebar',
      minimized: false,
      edge: 'right'
    })
  })

  it('clears minimized when docking', () => {
    // The reader pressed dock on an open panel. Leaving the flag set would
    // collapse the chat the moment they undocked.
    expect(setChatPresentationMode({ ...floatingOpen, minimized: true }, 'sidebar')).toMatchObject({
      mode: 'sidebar',
      minimized: false
    })
  })

  it('keeps minimized across an undock, so the panel comes back as it was', () => {
    const minimizedThenDocked = setChatPresentationMode(
      setChatPresentationMinimized(floatingOpen, true),
      'floating'
    )
    expect(minimizedThenDocked).toMatchObject({ mode: 'floating', minimized: true })
  })

  it('records the edge a dock targets, and leaves it alone otherwise', () => {
    expect(setChatPresentationMode(floatingOpen, 'sidebar', 'left').edge).toBe('left')
    expect(setChatPresentationMode(floatingOpen, 'sidebar').edge).toBe('right')
  })

  it('treats a docked chat as showing a panel whatever minimized says', () => {
    expect(isChatPresentationOpen({ ...floatingOpen, mode: 'sidebar', minimized: true })).toBe(true)
    expect(isChatPresentationOpen({ ...floatingOpen, minimized: true })).toBe(false)
    expect(isChatPresentationOpen(floatingOpen)).toBe(true)
  })
})

describe('the persisted record', () => {
  it('round-trips', () => {
    expect(parseChatPresentation(serializeChatPresentation(floatingOpen))).toEqual(floatingOpen)
  })

  it('rejects a record from another version rather than guessing at it', () => {
    const foreign = JSON.stringify({
      version: CHAT_PRESENTATION_STORAGE_VERSION + 1,
      mode: 'sidebar',
      minimized: false,
      edge: 'left'
    })
    expect(parseChatPresentation(foreign)).toBeNull()
  })

  it.each([
    ['absent', null],
    ['corrupt', '{not json'],
    ['not an object', '"sidebar"']
  ])('reads %s storage as no preference', (_label, raw) => {
    expect(parseChatPresentation(raw)).toBeNull()
  })

  it('falls back per field rather than discarding a partly unrecognised record', () => {
    const partial = JSON.stringify({
      version: CHAT_PRESENTATION_STORAGE_VERSION,
      mode: 'diagonal',
      minimized: false,
      edge: 'northwest'
    })
    expect(parseChatPresentation(partial)).toEqual({
      mode: DEFAULT_CHAT_PRESENTATION.mode,
      minimized: false,
      edge: DEFAULT_CHAT_PRESENTATION.edge
    })
  })

  it('survives storage throwing, in both directions', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })

    expect(readChatPresentation('k')).toBeNull()
    expect(() => {
      writeChatPresentation('k', floatingOpen)
    }).not.toThrow()

    getItem.mockRestore()
    setItem.mockRestore()
  })
})

describe('the store', () => {
  it('reports the default before storage is read, so hydration agrees with the server', () => {
    writeChatPresentation('k', floatingOpen)
    const store = createChatPresentationStore({ storageKey: 'k' })

    expect(store.readServer()).toEqual(DEFAULT_CHAT_PRESENTATION)
    expect(store.read()).toEqual(floatingOpen)
  })

  it('hands out one cached object, because useSyncExternalStore compares by identity', () => {
    const store = createChatPresentationStore({ storageKey: 'k' })
    expect(store.read()).toBe(store.read())
    expect(store.readServer()).toBe(store.readServer())
  })

  it('notifies subscribers and persists on a real change only', () => {
    const store = createChatPresentationStore({ storageKey: 'k' })
    const listener = vi.fn()
    store.subscribe(listener)

    store.update((current) => setChatPresentationMinimized(current, false))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(readChatPresentation('k')).toMatchObject({ minimized: false })

    store.update((current) => setChatPresentationMinimized(current, false))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('carries ephemeral host fields without ever persisting them', () => {
    const store = createChatPresentationStore<ChatPresentation & { focused: boolean }>({
      storageKey: 'k',
      hydrate: (persisted) => ({ ...persisted, focused: false })
    })

    store.update((current) => ({ ...openChatPresentation(current), focused: true }))

    expect(store.read().focused).toBe(true)
    expect(window.localStorage.getItem('k:presentation')).not.toContain('focused')
  })

  it('re-reads storage after a reset', () => {
    const store = createChatPresentationStore({ storageKey: 'k' })
    expect(store.read()).toEqual(DEFAULT_CHAT_PRESENTATION)

    writeChatPresentation('k', floatingOpen)
    expect(store.read()).toEqual(DEFAULT_CHAT_PRESENTATION)

    store.reset()
    expect(store.read()).toEqual(floatingOpen)
  })

  it('supports an in-memory controller without reading or writing presentation storage', () => {
    writeChatPresentation('k', { ...floatingOpen, mode: 'sidebar', edge: 'left' })
    const fallback: ChatPresentation = { mode: 'floating', minimized: false, edge: 'right' }
    const store = createChatPresentationStore({
      storageKey: 'k',
      defaultPresentation: fallback,
      persist: false
    })

    expect(store.read()).toEqual(fallback)
    store.update((current) => setChatPresentationMode(current, 'sidebar', 'top'))
    expect(store.read()).toMatchObject({ mode: 'sidebar', edge: 'top' })
    // The pre-existing record was neither read nor replaced.
    expect(readChatPresentation('k')).toMatchObject({ mode: 'sidebar', edge: 'left' })
  })
})
