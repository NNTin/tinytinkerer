import { ChatApp } from '@tinytinkerer/app-browser'
import { useRequestAssistantAction } from '@tinytinkerer/app-shell'
import { MermaidStage } from '@tinytinkerer/mermaid'
import { MermaidChatLoading } from './app/loading-screen'

const MermaidPage = (): React.JSX.Element => {
  const requestAssistantAction = useRequestAssistantAction()
  return (
    <MermaidStage
      onRequestAssistantFix={requestAssistantAction}
      assistant={
        <ChatApp
          mode="sidebar"
          morphable={false}
          fill
          storageKey="tinytinkerer:mermaid-chat-layout:v1"
          LoadingComponent={MermaidChatLoading}
          inspectorPanelSupported
        />
      }
    />
  )
}
export default MermaidPage
