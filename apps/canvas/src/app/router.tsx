import { lazy, Suspense } from 'react'
import { createHashRouter } from 'react-router-dom'
import { CanvasRouteLoading } from './loading-screen'

const CanvasPage = lazy(() =>
  import('../features/canvas/canvas-page').then((module) => ({ default: module.CanvasPage }))
)
const CallbackPage = lazy(() =>
  import('../features/auth/callback-page').then((module) => ({ default: module.CallbackPage }))
)

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
