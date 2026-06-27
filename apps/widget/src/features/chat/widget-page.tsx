import { FloatingWidgetChat } from '@tinytinkerer/app-browser'
import { WidgetChatLoading } from '../../app/loading-screen'
import { resolveWidgetViewMode, resolveWidgetWindowMode } from '../../runtime-config'

// localStorage key the standalone window persists its layout under.
const STANDALONE_LAYOUT_KEY = 'tinytinkerer:widget-layout:v1'

// The widget app is a thin shell over the shared FloatingWidgetChat: it only
// resolves the embedder's view/window mode from the URL and hands the shared
// floating chat the widget's boot copy and layout storage key. All the window
// chrome, drag/resize/keyboard layout, host-embed messaging, and the chat body
// live in @tinytinkerer/app-browser so the canvas app reuses the exact surface.
export const WidgetPage = () => (
  <FloatingWidgetChat
    viewMode={resolveWidgetViewMode(window.location.search)}
    initialMinimized={resolveWidgetWindowMode(window.location.search) === 'minimized'}
    storageKey={STANDALONE_LAYOUT_KEY}
    LoadingComponent={WidgetChatLoading}
  />
)
