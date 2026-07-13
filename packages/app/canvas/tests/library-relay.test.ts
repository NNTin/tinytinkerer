import { describe, expect, it, vi } from 'vitest'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { importLibraryFromMessage } from '../src/library-relay'

const api = (updateLibrary = vi.fn().mockResolvedValue(undefined)) =>
  ({ updateLibrary }) as unknown as ExcalidrawImperativeAPI
const response = (body: string, ok = true): Response =>
  ({ ok, text: () => Promise.resolve(body) }) as unknown as Response

describe('importLibraryFromMessage', () => {
  it('fetches an allow-listed library and imports it through the live API', async () => {
    const updateLibrary = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi.fn().mockResolvedValue(response('{"libraryItems":[]}'))

    await importLibraryFromMessage(
      { libraryUrl: 'https://libraries.excalidraw.com/foo.excalidrawlib' },
      api(updateLibrary),
      fetchImpl
    )

    expect(fetchImpl).toHaveBeenCalledWith('https://libraries.excalidraw.com/foo.excalidrawlib')
    const options = updateLibrary.mock.calls[0]?.[0] as unknown as Record<string, unknown>
    expect(options).toMatchObject({
      merge: true,
      openLibraryMenu: true,
      defaultStatus: 'published'
    })
    expect(options.libraryItems).toBeInstanceOf(Blob)
  })

  it('rejects non-excalidraw.com URLs without fetching', async () => {
    const fetchImpl = vi.fn()
    await importLibraryFromMessage(
      { libraryUrl: 'https://evil.example.com/x.excalidrawlib' },
      api(),
      fetchImpl
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not import when the fetch fails', async () => {
    const updateLibrary = vi.fn()
    await importLibraryFromMessage(
      { libraryUrl: 'https://excalidraw.com/x.excalidrawlib' },
      api(updateLibrary),
      vi.fn().mockResolvedValue(response('', false))
    )
    expect(updateLibrary).not.toHaveBeenCalled()
  })
})
