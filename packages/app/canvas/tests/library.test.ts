import { describe, expect, it, vi } from 'vitest'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { importLibraryContent } from '../src/library'

const fakeApi = (): ExcalidrawImperativeAPI =>
  ({ updateLibrary: vi.fn(() => Promise.resolve([])) }) as unknown as ExcalidrawImperativeAPI

describe('importLibraryContent', () => {
  it('hands the raw library text to updateLibrary as a merged Blob', async () => {
    const api = fakeApi()
    const content = JSON.stringify({
      type: 'excalidrawlib',
      version: 2,
      libraryItems: [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    })

    const result = await importLibraryContent(api, content)

    expect(result).toEqual({ ok: true, imported: 3 })
    const arg = vi.mocked(api.updateLibrary).mock.calls[0]?.[0] as {
      libraryItems: Blob
      merge: boolean
      openLibraryMenu: boolean
      defaultStatus: string
    }
    expect(arg.libraryItems).toBeInstanceOf(Blob)
    expect(arg).toMatchObject({ merge: true, openLibraryMenu: true, defaultStatus: 'published' })
  })

  it('counts legacy `library` items and tolerates unparseable content', async () => {
    const api = fakeApi()
    await expect(
      importLibraryContent(api, JSON.stringify({ library: [{ id: 'a' }] }))
    ).resolves.toEqual({ ok: true, imported: 1 })
    // Still imports (Excalidraw's loader validates); count falls back to 0.
    await expect(importLibraryContent(api, 'not json')).resolves.toEqual({
      ok: true,
      imported: 0
    })
  })
})
