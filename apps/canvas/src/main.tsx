import { createBrowserShellRoot } from '@tinytinkerer/app-browser'
import { router } from './app/router'
import { CanvasBootScreen } from './app/loading-screen'
import { createCanvasAppTools } from './canvas-runtime'
import '@tinytinkerer/app-browser/styles.css'
import '@tinytinkerer/app-harness/styles.css'
import './index.css'

createBrowserShellRoot({
  router,
  BootScreen: CanvasBootScreen,
  appTools: createCanvasAppTools()
})
