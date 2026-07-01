import { HarnessShell, resolveEmbeddedAppUrl } from '@tinytinkerer/app-harness'
import {
  EXCALIDRAW_APP_ID,
  EXCALIDRAW_PROTOCOL_VERSION,
  EXCALIDRAW_VERBS
} from '@tinytinkerer/excalidraw-protocol'
import { CanvasChatLoading } from './app/loading-screen'
import { canvasBridgeHandle } from './canvas-runtime'
import { useLibraryImportRelay } from './library-relay'

const CanvasPage = (): React.JSX.Element => {
  // Relay Excalidraw library imports from the same-origin callback tab into the iframe.
  useLibraryImportRelay()
  return (
    <HarnessShell
      appId={EXCALIDRAW_APP_ID}
      src={resolveEmbeddedAppUrl(import.meta.env.BASE_URL, 'excalidraw-app')}
      appProtocolVersion={EXCALIDRAW_PROTOCOL_VERSION}
      expectedVerbs={EXCALIDRAW_VERBS}
      handle={canvasBridgeHandle}
      frameTitle="Excalidraw whiteboard"
      persistenceKey="tinytinkerer:canvas-scene:v1"
      chat={{
        viewMode: 'standalone',
        storageKey: 'tinytinkerer:canvas-layout:v2',
        LoadingComponent: CanvasChatLoading
      }}
    />
  )
}

export default CanvasPage
