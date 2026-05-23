import { createChatRuntime } from '@tinytinkerer/app-core'
import { GitHubModelsProvider } from './github-models-provider'
import { createWebSearchTool } from './web-search-tool'

export const createRuntime = (options: {
  baseUrl: string
  searchEnabled: boolean
  getToken: () => string | null | undefined
  getModel: () => string | null | undefined
}) =>
  createChatRuntime({
    provider: new GitHubModelsProvider({
      baseUrl: options.baseUrl,
      getToken: options.getToken,
      getModel: options.getModel
    }),
    tools: options.searchEnabled ? [createWebSearchTool(options.baseUrl)] : [],
    searchEnabled: options.searchEnabled
  })
