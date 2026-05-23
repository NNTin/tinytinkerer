import { beforeEach, describe, expect, it, vi } from 'vitest'

const authInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const chatInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const settingsInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const statusInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../src/stores/auth-store.js', () => ({
  useAuthStore: {
    getState: () => ({ initialize: authInitialize })
  }
}))

vi.mock('../src/stores/chat-store.js', () => ({
  useChatStore: {
    getState: () => ({ initialize: chatInitialize })
  }
}))

vi.mock('../src/stores/settings-store.js', () => ({
  useSettingsStore: {
    getState: () => ({ initialize: settingsInitialize })
  }
}))

vi.mock('../src/stores/status-store.js', () => ({
  useStatusStore: {
    getState: () => ({ initialize: statusInitialize })
  }
}))

import { bootstrapBrowserShell } from '../src/initialize.js'
import { getBrowserShellConfig } from '../src/shell.js'

describe('bootstrapBrowserShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('configures the shell and initializes shared browser stores together', async () => {
    await bootstrapBrowserShell({
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'tinytinkerer-test',
      githubClientId: 'github-client-id'
    })

    expect(getBrowserShellConfig()).toMatchObject({
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'tinytinkerer-test',
      githubClientId: 'github-client-id'
    })
    expect(authInitialize).toHaveBeenCalledTimes(1)
    expect(chatInitialize).toHaveBeenCalledTimes(1)
    expect(settingsInitialize).toHaveBeenCalledTimes(1)
    expect(statusInitialize).toHaveBeenCalledTimes(1)
  })
})
