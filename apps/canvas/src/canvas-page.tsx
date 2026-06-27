import { HarnessShell } from '@tinytinkerer/app-harness'
import { EXCALIDRAW_APP_ID, EXCALIDRAW_PROTOCOL_VERSION } from '@tinytinkerer/excalidraw-protocol'
import { CanvasChatLoading } from './app/loading-screen'
import { canvasBridgeHandle } from './canvas-runtime'

export const resolveExcalidrawAppSrc = (baseUrl: string): string => {
  const deploymentRoot = baseUrl.endsWith('/canvas/')
    ? baseUrl.slice(0, -'canvas/'.length)
    : baseUrl
  return `${deploymentRoot}excalidraw-app/`
}

const CanvasPage = (): React.JSX.Element => (
  <HarnessShell
    appId={EXCALIDRAW_APP_ID}
    src={resolveExcalidrawAppSrc(import.meta.env.BASE_URL)}
    protocolVersion={EXCALIDRAW_PROTOCOL_VERSION}
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
