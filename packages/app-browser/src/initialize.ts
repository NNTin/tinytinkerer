import type { BrowserShellConfig } from './config'
import { createBrowserApp, type BrowserApp } from './app'

export const bootstrapBrowserShell = (config: BrowserShellConfig): Promise<BrowserApp> =>
  createBrowserApp(config)
