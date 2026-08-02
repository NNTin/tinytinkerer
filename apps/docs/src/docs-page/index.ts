/**
 * Public surface of the documentation page context (issue #476).
 *
 * Consumers — assistant tools and the later global widget — should import from
 * here rather than reaching into the provider or the resolver directly.
 */
export { DocsPageProvider, useDocsPageContext } from './docs-page-context'
export type { DocsPageContextValue } from './docs-page-context'
export type {
  DocsActiveDocument,
  DocsActiveDocumentState,
  DocsActiveRoute,
  DocsNoActiveDocumentReason,
  DocsPageDiagnostic,
  DocsPageDiagnosticCode,
  DocsPageResolution
} from './active-document'
// The same resolution, for consumers that cannot use a hook — an agent tool's
// `execute` runs outside React. See page-snapshot.ts.
export {
  awaitDocsPageSnapshot,
  readDocsPageSnapshot,
  subscribeDocsPageSnapshot
} from './page-snapshot'
export type { DocsPageSnapshot } from './page-snapshot'
