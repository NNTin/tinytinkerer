import { createBrowserShellRoot } from '@tinytinkerer/app-browser'
import { createMermaidAppTools, MERMAID_STARTER_PROMPTS } from '@tinytinkerer/mermaid'
import { router } from './app/router'
import { MermaidBootScreen } from './app/loading-screen'
import '@tinytinkerer/app-browser/styles.css'
import '@tinytinkerer/app-shell/styles.css'
import '@tinytinkerer/mermaid/styles.css'
import './index.css'

createBrowserShellRoot({
  router,
  // Every product shell carries the full catalogue. Reached through a dynamic
  // import() so the per-plugin map stays out of this entry chunk — see
  // PluginCatalogue's doc comment in app-browser.
  plugins: () => import('@tinytinkerer/catalogue').then((m) => m.loadProductPlugins()),
  BootScreen: MermaidBootScreen,
  starterPrompts: MERMAID_STARTER_PROMPTS,
  appToolGroup: { id: 'mermaid', label: 'Mermaid', tools: createMermaidAppTools() }
})
