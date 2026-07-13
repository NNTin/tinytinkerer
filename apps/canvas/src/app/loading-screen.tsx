import { createAppLoadingScreens } from '@tinytinkerer/app-browser'

const screens = createAppLoadingScreens({
  boot: {
    eyebrow: 'Canvas Boot',
    title: 'Loading tinytinkerer',
    message: 'Starting the integrated canvas workspace.'
  },
  route: {
    eyebrow: 'Route Loading',
    title: 'Opening the canvas',
    message: 'Preparing the whiteboard stage.'
  },
  chat: {
    eyebrow: 'Chat Runtime',
    title: 'Hydrating the session',
    message: 'Loading the conversation controller.'
  }
})

export const CanvasBootScreen = screens.BootScreen
export const CanvasRouteLoading = screens.RouteLoading
export const CanvasChatLoading = screens.ChatLoading
