/**
 * Public surface of the documentation page context (issue #476).
 *
 * Consumers — assistant tools and the later global widget — should import from
 * here rather than reaching into the provider or the resolver directly.
 */
export { DocsPageProvider, useDocsPageContext } from './docs-page-context'
export type {
  DocsActiveDocument,
  DocsActiveDocumentState,
  DocsNoActiveDocumentReason,
  DocsPageContextValue,
  DocsPageDiagnostic,
  DocsPageDiagnosticCode
} from './active-document'
