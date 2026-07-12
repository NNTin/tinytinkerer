import { createBrowserShellRoot } from '@tinytinkerer/app-browser'
import { createMermaidAppTools, MERMAID_STARTER_PROMPTS } from '@tinytinkerer/mermaid'
import { router } from './app/router'
import { MermaidBootScreen } from './app/loading-screen'
import '@tinytinkerer/app-browser/styles.css'
import '@tinytinkerer/app-harness/styles.css'
import '@tinytinkerer/mermaid/styles.css'
import './index.css'

createBrowserShellRoot({
  router,
  BootScreen: MermaidBootScreen,
  starterPrompts: MERMAID_STARTER_PROMPTS,
  appToolGroup: { id: 'mermaid', label: 'Mermaid', tools: createMermaidAppTools() }
})
