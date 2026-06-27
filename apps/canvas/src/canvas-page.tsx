import { HarnessShell, resolveSiblingAppUrl } from '@tinytinkerer/app-harness'
import {
  EXCALIDRAW_APP_ID,
  EXCALIDRAW_PROTOCOL_VERSION,
  EXCALIDRAW_VERBS
} from '@tinytinkerer/excalidraw-protocol'
import { CanvasChatLoading } from './app/loading-screen'
import { canvasBridgeHandle } from './canvas-runtime'

const CanvasPage = (): React.JSX.Element => (
  <HarnessShell
    appId={EXCALIDRAW_APP_ID}
    src={resolveSiblingAppUrl(import.meta.env.BASE_URL, 'excalidraw-app')}
    protocolVersion={EXCALIDRAW_PROTOCOL_VERSION}
    expectedVerbs={EXCALIDRAW_VERBS}
    handle={canvasBridgeHandle}
    frameTitle="Excalidraw whiteboard"
    chat={{
      viewMode: 'standalone',
      storageKey: 'tinytinkerer:canvas-layout:v2',
      LoadingComponent: CanvasChatLoading
    }}
  />
)

export default CanvasPage
