import { useEffect } from 'react'
import {
  EXCALIDRAW_LIBRARY_CHANNEL,
  EXCALIDRAW_LIBRARY_IMPORT_VERB,
  isAllowedLibraryUrl
} from '@tinytinkerer/excalidraw-protocol'
import type { AppBridgeHandle } from '@tinytinkerer/app-harness'
import { canvasBridgeHandle } from './canvas-runtime'

type LibraryMessage = { libraryUrl?: unknown; idToken?: unknown }

// A raw cross-origin GET of a public excalidraw.com library file. fetchWithTelemetry
// only models first-party origins (edge/github/litellm/tavily), and a failure here
// degrades gracefully (no import), so the global fetch is the right tool.
// eslint-disable-next-line no-restricted-globals -- external library fetch; see comment above.
const libraryFetch: typeof fetch = fetch

// Fetch a validated Excalidraw library and push it into the iframe over the bridge.
// The library callback page (a same-origin new tab) posts the `addLibrary` URL here;
// the fetch happens on the real origin (the sandboxed iframe could not fetch it). The
// URL is allow-listed to excalidraw.com so a crafted message cannot point us elsewhere.
// `fetchImpl` is injectable for tests.
export const importLibraryFromMessage = async (
  message: LibraryMessage,
  handle: AppBridgeHandle,
  fetchImpl: typeof fetch = libraryFetch
): Promise<void> => {
  const libraryUrl = typeof message.libraryUrl === 'string' ? message.libraryUrl : null
  if (!libraryUrl || !isAllowedLibraryUrl(libraryUrl)) return
  const response = await fetchImpl(libraryUrl)
  if (!response.ok) return
  const content = await response.text()
  await handle.request(EXCALIDRAW_LIBRARY_IMPORT_VERB, { content })
}

// Listen on the same-origin library channel and relay imports into the iframe. A
// request issued before the bridge is ready rejects harmlessly (swallowed here).
export const useLibraryImportRelay = (handle: AppBridgeHandle = canvasBridgeHandle): void => {
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(EXCALIDRAW_LIBRARY_CHANNEL)
    const onMessage = (event: MessageEvent): void => {
      void importLibraryFromMessage(event.data as LibraryMessage, handle).catch(() => {})
    }
    channel.addEventListener('message', onMessage)
    return () => {
      channel.removeEventListener('message', onMessage)
      channel.close()
    }
  }, [handle])
}
