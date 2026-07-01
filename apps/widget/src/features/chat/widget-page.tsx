import { ChatApp } from '@tinytinkerer/app-browser'
import { WidgetChatLoading } from '../../app/loading-screen'
import { resolveWidgetWindowMode } from '../../runtime-config'

// localStorage key the layout persists its geometry/mode under (each layout adds
// its own suffix).
const LAYOUT_KEY = 'tinytinkerer:widget-layout:v1'

// The widget app is a thin shell over the shared ChatApp in its floating layout. It
// resolves the requested window mode from the URL and hands the shared App the
// widget's boot copy and layout storage key. Being morphable, the floating window
// exposes a dock button that morphs it into the docked sidebar layout (and back).
export const WidgetPage = () => (
  <ChatApp
    mode="floating"
    storageKey={LAYOUT_KEY}
    LoadingComponent={WidgetChatLoading}
    initialMinimized={resolveWidgetWindowMode(window.location.search) === 'minimized'}
  />
)
