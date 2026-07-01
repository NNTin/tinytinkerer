import { EXCALIDRAW_LIBRARY_CHANNEL } from '@tinytinkerer/excalidraw-protocol'

// Same-origin relay for Excalidraw library imports. libraries.excalidraw.com sends the
// "Add to Excalidraw" round-trip to this page (a new tab) as
// `…/canvas/library-callback/#addLibrary=<url>&token=<token>`, because the canvas iframe
// itself is sandboxed/opaque-origin and cannot receive that navigation. This page reads
// the params and hands them to the live canvas tab over a same-origin BroadcastChannel,
// which forwards the library into the iframe via the bridge. It then closes itself.

const setStatus = (text: string): void => {
  const status = document.getElementById('status')
  if (status) status.textContent = text
}

const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
const rawLibraryUrl = params.get('addLibrary')

if (rawLibraryUrl) {
  // Mirror Excalidraw's consumer, which decodes the URLSearchParams value once more.
  const libraryUrl = decodeURIComponent(rawLibraryUrl)
  const idToken = params.get('token')
  try {
    const channel = new BroadcastChannel(EXCALIDRAW_LIBRARY_CHANNEL)
    channel.postMessage({ libraryUrl, idToken })
    channel.close()
    setStatus('Library sent to the canvas — you can close this tab.')
  } catch {
    setStatus('Could not deliver the library to the canvas.')
  }
  // Best-effort: this tab was opened by a script, so it may close itself. A short delay
  // lets the BroadcastChannel message flush first.
  window.setTimeout(() => window.close(), 250)
} else {
  setStatus('No library to import.')
}
