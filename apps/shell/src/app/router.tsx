import { lazy, Suspense } from 'react'
import { createHashRouter } from 'react-router-dom'
import type { ShellPresentation } from '../presentations'

// The chat surface and the OAuth callback are lazy so the entry stays small (the
// bundle-size guard enforces this). The router is built from the resolved
// presentation, which supplies the route-loading chrome and the ChatApp config.
const ChatRoute = lazy(() =>
  import('../features/chat/chat-surface').then((m) => ({ default: m.ShellChatPage }))
)
const CallbackRoute = lazy(() =>
  import('../features/auth/callback-page').then((m) => ({ default: m.CallbackPage }))
)

export const createShellRouter = (presentation: ShellPresentation) => {
  const { RouteLoading } = presentation

  return createHashRouter([
    {
      path: '/',
      element: (
        <Suspense fallback={<RouteLoading />}>
          <ChatRoute presentation={presentation} />
        </Suspense>
      )
    },
    {
      path: '/auth/callback',
      element: (
        <Suspense fallback={<RouteLoading />}>
          <CallbackRoute />
        </Suspense>
      )
    }
  ])
}
