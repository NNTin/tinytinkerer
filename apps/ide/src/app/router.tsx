import { lazy, Suspense } from 'react'
import { createHashRouter } from 'react-router-dom'
import { IdeRouteLoading } from './loading-screen'

const IdePage = lazy(() => import('../ide-page'))
const CallbackPage = lazy(() => import('../callback-page'))

export const router = createHashRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<IdeRouteLoading />}>
        <IdePage />
      </Suspense>
    )
  },
  {
    path: '/auth/callback',
    element: (
      <Suspense fallback={<IdeRouteLoading />}>
        <CallbackPage />
      </Suspense>
    )
  }
])
