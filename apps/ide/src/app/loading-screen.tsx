import { createAppLoadingScreens } from '@tinytinkerer/app-browser'

const screens = createAppLoadingScreens({
  boot: {
    eyebrow: 'IDE Boot',
    title: 'Loading TinyTinkerer IDE',
    message: 'Starting the browser workspace and assistant.'
  },
  route: {
    eyebrow: 'Route Loading',
    title: 'Opening the IDE',
    message: 'Preparing the virtual workspace.'
  },
  chat: {
    eyebrow: 'Chat Runtime',
    title: 'Hydrating the session',
    message: 'Loading the conversation controller.'
  }
})

export const IdeBootScreen = screens.BootScreen
export const IdeRouteLoading = screens.RouteLoading
export const IdeChatLoading = screens.ChatLoading
