import { lazy, Suspense } from 'react'
import { createHashRouter } from 'react-router-dom'
import { WebRouteLoading } from './loading-screen'

const ChatPage = lazy(() =>
  import('../features/chat/chat-page').then((m) => ({ default: m.ChatPage }))
)
const CallbackPage = lazy(() =>
  import('../features/auth/callback-page').then((m) => ({ default: m.CallbackPage }))
)

export const router = createHashRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<WebRouteLoading />}>
        <ChatPage />
      </Suspense>
    )
  },
  {
    path: '/auth/callback',
    element: (
      <Suspense fallback={<WebRouteLoading />}>
        <CallbackPage />
      </Suspense>
    )
  }
])
