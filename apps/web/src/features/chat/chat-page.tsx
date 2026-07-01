import { ChatApp, ContextInspectorSlot } from '@tinytinkerer/app-browser'
import { FaReceipt } from '@tinytinkerer/ui'
import { WebChatLoading, WebPanelLoading } from '../../app/loading-screen'

// The web shell is a thin wrapper over the shared ChatApp in its docked (sidebar)
// layout. The chat body, composer, settings, and state all live in the shared App;
// the web shell only supplies its boot copy, its layout storage key, and the
// developer context-inspector slot (web only — its trigger icon comes from
// @tinytinkerer/ui, which the shared App package cannot import).
export const ChatPage = () => (
  <ChatApp
    mode="sidebar"
    morphable={false}
    sizeVariant="comfortable"
    storageKey="tinytinkerer:web-layout:v1"
    LoadingComponent={WebChatLoading}
    inspectorPanelSupported
    settingsFallback={<WebPanelLoading />}
    inspectorSlot={
      <ContextInspectorSlot icon={<FaReceipt className="h-4 w-4" aria-hidden="true" />} />
    }
  />
)
