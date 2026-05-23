import type { StatusGateway } from '@tinytinkerer/app-core'
import { systemStatusSchema } from '@tinytinkerer/contracts'
import { createBrowserPersistence } from './db'
import { resolveBrowserShellConfig, type BrowserShellConfig, type ResolvedBrowserShellConfig } from './config'

type BrowserShell = {
  config: ResolvedBrowserShellConfig
  conversations: ReturnType<typeof createBrowserPersistence>['conversations']
  preferences: ReturnType<typeof createBrowserPersistence>['preferences']
  authTokens: ReturnType<typeof createBrowserPersistence>['authTokens']
  statusGateway: StatusGateway
}

const createStatusGateway = (config: ResolvedBrowserShellConfig): StatusGateway => ({
  async fetchStatus() {
    const response = await fetch(`${config.edgeBaseUrl}/health`)
    if (!response.ok) {
      throw new Error('Unable to reach edge status endpoint')
    }

    return systemStatusSchema.parse(await response.json())
  }
})

const buildShell = (config: BrowserShellConfig = {}): BrowserShell => {
  const resolved = resolveBrowserShellConfig(config)
  const persistence = createBrowserPersistence(resolved.storageNamespace, resolved.hostToken)

  return {
    config: resolved,
    conversations: persistence.conversations,
    preferences: persistence.preferences,
    authTokens: persistence.authTokens,
    statusGateway: createStatusGateway(resolved)
  }
}

let currentShell = buildShell()

export const initializeBrowserShell = (config: BrowserShellConfig = {}): void => {
  currentShell = buildShell(config)
}

export const getBrowserShell = (): BrowserShell => currentShell

export const getBrowserShellConfig = (): ResolvedBrowserShellConfig => currentShell.config
