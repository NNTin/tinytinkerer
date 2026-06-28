import { mountExcalidrawApp } from '@tinytinkerer/excalidraw-app'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element.')

const unmount = mountExcalidrawApp(root, window.location.hash)
if (import.meta.hot) {
  import.meta.hot.dispose(unmount)
}
