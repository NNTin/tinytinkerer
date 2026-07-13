import { createAppShellRouter } from '@tinytinkerer/app-browser'
import { PixelAgentsRouteLoading } from './loading-screen'

export const router = createAppShellRouter({
  loadHome: () => import('../pixel-agents-page'),
  LoadingComponent: PixelAgentsRouteLoading
})
