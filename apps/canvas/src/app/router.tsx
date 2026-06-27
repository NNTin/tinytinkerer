import { lazy, Suspense } from 'react'
import { createHashRouter } from 'react-router-dom'
import { CanvasRouteLoading } from './loading-screen'

const CanvasPage = lazy(() => import('../canvas-page'))
const CallbackPage = lazy(() => import('../callback-page'))

export const router = createHashRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<CanvasRouteLoading />}>
        <CanvasPage />
      </Suspense>
    )
  },
  {
    path: '/auth/callback',
    element: (
      <Suspense fallback={<CanvasRouteLoading />}>
        <CallbackPage />
      </Suspense>
    )
  }
])
