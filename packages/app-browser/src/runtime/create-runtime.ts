import { createChatRuntime } from '@tinytinkerer/app-core'
import { contentDocumentToAssistantContentDocument } from '../content-document'
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
    createAssistantContentSession: async (initialSource = '') => {
      const { createMarkdownContentSession } = await import('@tinytinkerer/content-markdown')
      const session = createMarkdownContentSession(initialSource)
      return {
        append(chunk) {
          const snapshot = session.append(chunk)
          return {
            source: snapshot.source,
            content: contentDocumentToAssistantContentDocument(snapshot.document)
          }
        },
        replace(source) {
          const snapshot = session.replace(source)
          return {
            source: snapshot.source,
            content: contentDocumentToAssistantContentDocument(snapshot.document)
          }
        },
        snapshot() {
          const snapshot = session.snapshot()
          return {
            source: snapshot.source,
            content: contentDocumentToAssistantContentDocument(snapshot.document)
          }
        }
      }
    },
    tools: options.searchEnabled ? [createWebSearchTool(options.baseUrl)] : [],
    searchEnabled: options.searchEnabled
  })
