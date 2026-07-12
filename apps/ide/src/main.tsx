import { createBrowserShellRoot } from '@tinytinkerer/app-browser'
import { router } from './app/router'
import { IdeBootScreen } from './app/loading-screen'
import { createIdeAppTools } from './ide-runtime'
import '@tinytinkerer/app-browser/styles.css'
import '@tinytinkerer/app-harness/styles.css'
import '@tinytinkerer/ide/styles.css'
import './index.css'

createBrowserShellRoot({
  router,
  BootScreen: IdeBootScreen,
  appToolGroup: { id: 'ide', label: 'IDE', tools: createIdeAppTools() }
})
