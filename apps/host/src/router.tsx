import { lazy, Suspense } from 'react'
import { createHashRouter } from 'react-router-dom'
import { RootComposition } from './root-composition'
import { RootChatLoading } from './loading-screen'

// The OAuth callback is lazy, same as every other shell's router, so the callback
// chunk (and the app-browser surface it pulls in) stays out of the root's entry
// bundle (see the bundle-size guard in bundle-size.test.ts). Before this router
// existed the host had NO '/auth/callback' route at all: GitHub's redirect back to
// '/#/auth/callback' just re-rendered RootComposition, so
// completeGitHubOAuthCallback never ran and login silently failed with zero
// errors (issue #409 follow-up). Mirrors apps/shell/src/app/router.tsx and
// apps/canvas/src/app/router.tsx.
const CallbackRoute = lazy(() =>
  import('./callback-page').then((m) => ({ default: m.CallbackPage }))
)

export const hostRouter = createHashRouter([
  {
    path: '/',
    element: <RootComposition />
  },
  {
    path: '/auth/callback',
    element: (
      <Suspense fallback={<RootChatLoading />}>
        <CallbackRoute />
      </Suspense>
    )
  }
])
