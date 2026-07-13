import { lazy, Suspense, type ComponentType } from 'react'
import { createHashRouter, type RouterProviderProps } from 'react-router-dom'

const CallbackPage = lazy(() =>
  import('./browser-callback-page').then((module) => ({ default: module.BrowserCallbackPage }))
)

export type AppShellPageModule = {
  default: ComponentType
}

export type CreateAppShellRouterOptions = {
  loadHome: () => Promise<AppShellPageModule>
  LoadingComponent: ComponentType
}

export const createAppShellRouter = ({
  loadHome,
  LoadingComponent
}: CreateAppShellRouterOptions): RouterProviderProps['router'] => {
  const HomePage = lazy(loadHome)
  const fallback = <LoadingComponent />

  return createHashRouter([
    {
      path: '/',
      element: (
        <Suspense fallback={fallback}>
          <HomePage />
        </Suspense>
      )
    },
    {
      path: '/auth/callback',
      element: (
        <Suspense fallback={fallback}>
          <CallbackPage />
        </Suspense>
      )
    }
  ])
}
