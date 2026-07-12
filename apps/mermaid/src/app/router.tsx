import { lazy, Suspense } from 'react'
import { createHashRouter } from 'react-router-dom'
import { MermaidRouteLoading } from './loading-screen'
const MermaidPage = lazy(() => import('../mermaid-page'))
const CallbackPage = lazy(() => import('../callback-page'))
export const router = createHashRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<MermaidRouteLoading />}>
        <MermaidPage />
      </Suspense>
    )
  },
  {
    path: '/auth/callback',
    element: (
      <Suspense fallback={<MermaidRouteLoading />}>
        <CallbackPage />
      </Suspense>
    )
  }
])
