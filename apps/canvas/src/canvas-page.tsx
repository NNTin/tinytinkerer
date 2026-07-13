import { ChatApp } from '@tinytinkerer/app-browser'
import { CanvasStage } from '@tinytinkerer/canvas'
import { CanvasChatLoading } from './app/loading-screen'

const CanvasPage = (): React.JSX.Element => (
  <CanvasStage
    assistant={
      <ChatApp
        mode="sidebar"
        morphable={false}
        fill
        storageKey="tinytinkerer:canvas-chat-layout:v1"
        LoadingComponent={CanvasChatLoading}
        inspectorPanelSupported
      />
    }
  />
)

export default CanvasPage
