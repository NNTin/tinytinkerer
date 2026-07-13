import { createBrowserShellRoot } from '@tinytinkerer/app-browser'
import { router } from './app/router'
import { PixelAgentsBootScreen } from './app/loading-screen'
import '@tinytinkerer/app-browser/styles.css'
import '@tinytinkerer/app-shell/styles.css'
import '@tinytinkerer/pixel-agents/styles.css'
import './index.css'

createBrowserShellRoot({ router, BootScreen: PixelAgentsBootScreen })
