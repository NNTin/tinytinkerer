/**
 * Server-safe facade for corpus build tooling. Keep it free of browser/runtime
 * modules so Docusaurus config loading never evaluates the application barrel.
 */
export { DOCUMENTATION_CORPUS_SCHEMA_VERSION } from '@tinytinkerer/contracts'
export type {
  DocumentationCorpusDocumentArtifact,
  DocumentationCorpusLoadFailure,
  DocumentationCorpusLocator,
  DocumentationCorpusManifest,
  DocumentationCorpusManifestEntry,
  DocumentationCorpusOutlineItem,
  DocumentationCorpusReadTruncation,
  DocumentationCorpusSchemaVersion,
  DocumentationCorpusSection
} from '@tinytinkerer/contracts'
