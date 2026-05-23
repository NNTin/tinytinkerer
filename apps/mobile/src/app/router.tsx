import { lazy, Suspense } from 'react'
import { createHashRouter } from 'react-router-dom'

const MobilePage = lazy(() =>
  import('../features/chat/mobile-page').then((module) => ({ default: module.MobilePage }))
)
const CallbackPage = lazy(() =>
  import('../features/auth/callback-page').then((module) => ({ default: module.CallbackPage }))
)

export const router = createHashRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={null}>
        <MobilePage />
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
