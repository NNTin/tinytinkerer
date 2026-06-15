import { createBrowserShellRoot } from '@tinytinkerer/app-browser'
import { router } from './app/router'
import { MobileBootScreen } from './app/loading-screen'
import '@tinytinkerer/app-browser/styles.css'
import './index.css'

createBrowserShellRoot({ router, BootScreen: MobileBootScreen })
