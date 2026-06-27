import { createBrowserShellRoot } from '@tinytinkerer/app-browser'
import { router } from './app/router'
import { CanvasBootScreen } from './app/loading-screen'
import { createCanvasTools } from './canvas-tools'
import '@tinytinkerer/app-browser/styles.css'
import './index.css'

// The canvas app injects its own always-on Excalidraw tools (draw/read/clear) via
// the shell's `appTools` seam — no global plugin, no activation toggle.
createBrowserShellRoot({
  router,
  BootScreen: CanvasBootScreen,
  appTools: createCanvasTools()
})
