import type { BrowserShellConfig } from './config'
import { createBrowserApp, initializeBrowserApp, type BrowserApp } from './app'

export const bootstrapBrowserShell = async (config: BrowserShellConfig): Promise<BrowserApp> => {
  const app = createBrowserApp(config)
  await initializeBrowserApp(app, config)
  return app
}
