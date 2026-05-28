import { lazy } from 'react'

export const LazyBrowserSettingsModal = lazy(() =>
  import('./browser-settings-modal').then((module) => ({
    default: module.BrowserSettingsModal
  }))
)
