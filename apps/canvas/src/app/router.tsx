import { createAppShellRouter } from '@tinytinkerer/app-browser'
import { CanvasRouteLoading } from './loading-screen'

export const router = createAppShellRouter({
  loadHome: () => import('../canvas-page'),
  LoadingComponent: CanvasRouteLoading
})
