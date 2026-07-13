import { createAppShellRouter } from '@tinytinkerer/app-browser'
import { MermaidRouteLoading } from './loading-screen'

export const router = createAppShellRouter({
  loadHome: () => import('../mermaid-page'),
  LoadingComponent: MermaidRouteLoading
})
