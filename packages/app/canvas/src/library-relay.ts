import { useEffect } from 'react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { isAllowedLibraryUrl } from './inputs'
import { EXCALIDRAW_LIBRARY_CHANNEL } from './library-channel'
import { importLibraryContent } from './library'

type LibraryMessage = { libraryUrl?: unknown; idToken?: unknown }

// A raw cross-origin GET of a public excalidraw.com library file. The allow-list
// below constrains the destination and a failure degrades gracefully.
// eslint-disable-next-line no-restricted-globals -- external allow-listed library fetch
const libraryFetch: typeof fetch = fetch

export const importLibraryFromMessage = async (
  message: LibraryMessage,
  api: ExcalidrawImperativeAPI,
  fetchImpl: typeof fetch = libraryFetch
): Promise<void> => {
  const libraryUrl = typeof message.libraryUrl === 'string' ? message.libraryUrl : null
  if (!libraryUrl || !isAllowedLibraryUrl(libraryUrl)) return
  const response = await fetchImpl(libraryUrl)
  if (!response.ok) return
  await importLibraryContent(api, await response.text())
}

// The Excalidraw library callback opens on the same origin in another tab. Its
// BroadcastChannel message can now be applied directly to the in-process API.
export const useLibraryImportRelay = (api: ExcalidrawImperativeAPI | null): void => {
  useEffect(() => {
    if (!api || typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(EXCALIDRAW_LIBRARY_CHANNEL)
    const onMessage = (event: MessageEvent): void => {
      void importLibraryFromMessage(event.data as LibraryMessage, api).catch(() => {})
    }
    channel.addEventListener('message', onMessage)
    return () => {
      channel.removeEventListener('message', onMessage)
      channel.close()
    }
  }, [api])
}
