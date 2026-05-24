import { lazy, Suspense } from 'react'
import { createHashRouter } from 'react-router-dom'

const ChatPage = lazy(() => import('../features/chat/chat-page').then((m) => ({ default: m.ChatPage })))
const CallbackPage = lazy(() =>
  import('../features/auth/callback-page').then((m) => ({ default: m.CallbackPage }))
)

export const router = createHashRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={null}>
        <ChatPage />
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
