import { ChatApp, useChatStore } from '@tinytinkerer/app-browser'
import { PixelAgentsStage } from '@tinytinkerer/pixel-agents'
import { PixelAgentsChatLoading } from './app/loading-screen'

const PixelAgentsPage = (): React.JSX.Element => {
  const events = useChatStore((state) => state.events)
  const isRunning = useChatStore((state) => state.isRunning)

  return (
    <PixelAgentsStage
      events={events}
      isRunning={isRunning}
      assistant={
        <ChatApp
          mode="sidebar"
          morphable={false}
          fill
          storageKey="tinytinkerer:pixel-agents-chat-layout:v1"
          LoadingComponent={PixelAgentsChatLoading}
          inspectorPanelSupported
        />
      }
    />
  )
}

export default PixelAgentsPage
