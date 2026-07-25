import { createAppLoadingScreens } from '@tinytinkerer/app-browser'

const screens = createAppLoadingScreens({
  boot: {
    eyebrow: 'Plugin & Tool-Picker Lab',
    title: 'Loading the demo session',
    message: 'Starting the isolated docs conversation workspace.'
  },
  route: {
    eyebrow: 'Route Loading',
    title: 'Opening the lab',
    message: 'Preparing the animated office stage.'
  },
  chat: {
    eyebrow: 'Chat Runtime',
    title: 'Hydrating the session',
    message: 'Loading the demo conversation controller.'
  }
})

export const PluginToolPickerLabChatLoading = screens.ChatLoading
