import { lazy, Suspense } from 'react'
import { createHashRouter } from 'react-router-dom'

const WidgetPage = lazy(() =>
  import('../features/chat/widget-page').then((module) => ({ default: module.WidgetPage }))
)
const CallbackPage = lazy(() =>
  import('../features/auth/callback-page').then((module) => ({ default: module.CallbackPage }))
)

export const router = createHashRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={null}>
        <WidgetPage />
      </Suspense>
    )
  },
  {
    path: '/auth/callback',
    element: (
      <Suspense fallback={null}>
        <CallbackPage />
      </Suspense>
    )
  }
])
