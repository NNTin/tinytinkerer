import { describe, expect, it, vi } from 'vitest'
import type { AppBridgeHandle } from '@tinytinkerer/app-harness'
import { importLibraryFromMessage } from './library-relay'

const handle = (
  request = vi.fn().mockResolvedValue({ ok: true, imported: 1 })
): AppBridgeHandle => ({
  setClient: vi.fn(),
  setUnavailable: vi.fn(),
  getStatus: () => 'ready',
  request
})

const textResponse = (body: string, ok = true): Response =>
  ({ ok, text: () => Promise.resolve(body) }) as unknown as Response

describe('importLibraryFromMessage', () => {
  it('fetches an allow-listed library and forwards its text over the bridge', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, imported: 2 })
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('{"libraryItems":[]}'))

    await importLibraryFromMessage(
      { libraryUrl: 'https://libraries.excalidraw.com/foo.excalidrawlib' },
      handle(request),
      fetchImpl
    )

    expect(fetchImpl).toHaveBeenCalledWith('https://libraries.excalidraw.com/foo.excalidrawlib')
    expect(request).toHaveBeenCalledWith('excalidraw:import-library', {
      content: '{"libraryItems":[]}'
    })
  })

  it('rejects non-excalidraw.com URLs without fetching or importing', async () => {
    const request = vi.fn()
    const fetchImpl = vi.fn()
    await importLibraryFromMessage(
      { libraryUrl: 'https://evil.example.com/x.excalidrawlib' },
      handle(request),
      fetchImpl
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('ignores a missing or non-string library URL', async () => {
    const request = vi.fn()
    const fetchImpl = vi.fn()
    await importLibraryFromMessage({}, handle(request), fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('does not import when the fetch fails', async () => {
    const request = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('', false))
    await importLibraryFromMessage(
      { libraryUrl: 'https://excalidraw.com/x.excalidrawlib' },
      handle(request),
      fetchImpl
    )
    expect(request).not.toHaveBeenCalled()
  })
})
