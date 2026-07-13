import { createAppLoadingScreens } from '@tinytinkerer/app-browser'

const screens = createAppLoadingScreens({
  boot: {
    eyebrow: 'Mermaid Boot',
    title: 'Loading Mermaid workspace',
    message: 'Starting the diagram editor and assistant.'
  },
  route: {
    eyebrow: 'Route Loading',
    title: 'Opening Mermaid',
    message: 'Preparing the diagram workspace.'
  },
  chat: {
    eyebrow: 'Chat Runtime',
    title: 'Hydrating the session',
    message: 'Loading the conversation controller.'
  }
})

export const MermaidBootScreen = screens.BootScreen
export const MermaidRouteLoading = screens.RouteLoading
export const MermaidChatLoading = screens.ChatLoading
