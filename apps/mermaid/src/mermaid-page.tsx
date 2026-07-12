import { ChatApp, useBrowserApp } from '@tinytinkerer/app-browser'
import { MermaidStage } from '@tinytinkerer/mermaid'
import { MermaidChatLoading } from './app/loading-screen'

const MermaidPage = (): React.JSX.Element => {
  const app = useBrowserApp()
  return (
    <MermaidStage
      onRequestAssistantFix={(prompt) => app.stores.chat.getState().sendPrompt(prompt)}
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
