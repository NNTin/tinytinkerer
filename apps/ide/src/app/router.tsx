import { createAppShellRouter } from '@tinytinkerer/app-browser'
import { IdeRouteLoading } from './loading-screen'

export const router = createAppShellRouter({
  loadHome: () => import('../ide-page'),
  LoadingComponent: IdeRouteLoading
})
