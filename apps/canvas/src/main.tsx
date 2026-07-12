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
  // The canvas contributes its Excalidraw verbs as one always-on tool group. The
  // group id keys its per-tool disablement in the tool picker (issue #400); the
  // label is what the picker shows. Excalidraw itself is always present, so this
  // group has no activation toggle — unchecking every verb keeps it in the picker.
  appToolGroup: { id: 'canvas', label: 'Canvas', tools: createCanvasAppTools() }
})
