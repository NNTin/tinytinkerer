import { lazy } from 'react'

export const LazyBrowserSettingsModal = lazy(() =>
  import('./browser-settings-modal').then((module) => ({
    default: module.BrowserSettingsModal
  }))
)

// Lazy form of the shared tabbed SettingsPanel — used by shells that need to
// choose a presentation (e.g. the widget's inline slide-over).
export const LazySettingsPanel = lazy(() =>
  import('./browser-settings-modal').then((module) => ({
    default: module.SettingsPanel
  }))
)
