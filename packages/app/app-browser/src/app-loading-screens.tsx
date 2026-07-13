import { LoadingStatusPanel, type LoadingStatusPanelVariant } from './loading-status-panel'

type LoadingScreenCopy = {
  eyebrow: string
  title: string
  message: string
}

export type CreateAppLoadingScreensOptions = {
  variant?: LoadingStatusPanelVariant
  boot: LoadingScreenCopy
  route: LoadingScreenCopy
  chat: LoadingScreenCopy
}

export type AppLoadingScreenProps = { error?: string }

// Integrated application shells share behavior and markup while retaining concise,
// app-specific copy at their assembly boundary.
export const createAppLoadingScreens = ({
  variant = 'widget',
  boot,
  route,
  chat
}: CreateAppLoadingScreensOptions) => {
  const render = (copy: LoadingScreenCopy, error?: string) => (
    <LoadingStatusPanel variant={variant} {...copy} {...(error ? { error } : {})} />
  )

  return {
    BootScreen: ({ error }: AppLoadingScreenProps = {}) => render(boot, error),
    RouteLoading: () => render(route),
    ChatLoading: ({ error }: AppLoadingScreenProps = {}) => render(chat, error)
  }
}
