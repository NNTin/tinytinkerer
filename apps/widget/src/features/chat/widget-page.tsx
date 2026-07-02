import { ChatApp, ContextInspectorSlot } from '@tinytinkerer/app-browser'
import { FaReceipt } from '@tinytinkerer/ui'
import { WidgetChatLoading } from '../../app/loading-screen'
import { resolveWidgetWindowMode } from '../../runtime-config'

// localStorage key the layout persists its geometry/mode under (each layout adds
// its own suffix).
const LAYOUT_KEY = 'tinytinkerer:widget-layout:v1'

// The widget app is a thin shell over the shared ChatApp in its floating layout. It
// resolves the requested window mode from the URL and hands the shared App the
// widget's boot copy and layout storage key. Being morphable, the floating window
// exposes a dock button that morphs it into the docked sidebar layout (and back).
// Like the web shell, it hosts the developer context inspector: `inspectorPanelSupported`
// enables the inspector plugin's toggle in Settings, and the slot renders the viewer
// button once the plugin is enabled and context has been captured (in both views).
export const WidgetPage = () => (
  <ChatApp
    mode="floating"
    storageKey={LAYOUT_KEY}
    LoadingComponent={WidgetChatLoading}
    initialMinimized={resolveWidgetWindowMode(window.location.search) === 'minimized'}
    inspectorPanelSupported
    inspectorSlot={
      <ContextInspectorSlot icon={<FaReceipt className="h-4 w-4" aria-hidden="true" />} />
    }
  />
)
