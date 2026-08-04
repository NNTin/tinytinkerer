import { createBrowserShellRoot } from '@tinytinkerer/app-browser'
import { router } from './app/router'
import { PixelAgentsBootScreen } from './app/loading-screen'
import '@tinytinkerer/app-browser/styles.css'
import '@tinytinkerer/app-shell/styles.css'
import '@tinytinkerer/pixel-agents/styles.css'
import './index.css'

createBrowserShellRoot({
  router,
  // Every product shell carries the full catalogue. Reached through a dynamic
  // import() so the per-plugin map stays out of this entry chunk — see
  // PluginCatalogue's doc comment in app-browser.
  plugins: () => import('@tinytinkerer/catalogue').then((m) => m.loadProductPlugins()),
  BootScreen: PixelAgentsBootScreen
})
