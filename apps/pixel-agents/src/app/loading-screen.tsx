import { createAppLoadingScreens } from '@tinytinkerer/app-browser'

const screens = createAppLoadingScreens({
  boot: {
    eyebrow: 'Pixel Agents Boot',
    title: 'Loading tinytinkerer',
    message: 'Starting the integrated Pixel Agents workspace.'
  },
  route: {
    eyebrow: 'Route Loading',
    title: 'Opening Pixel Agents',
    message: 'Preparing the animated office stage.'
  },
  chat: {
    eyebrow: 'Chat Runtime',
    title: 'Hydrating the session',
    message: 'Loading the conversation controller.'
  }
})

export const PixelAgentsBootScreen = screens.BootScreen
export const PixelAgentsRouteLoading = screens.RouteLoading
export const PixelAgentsChatLoading = screens.ChatLoading
