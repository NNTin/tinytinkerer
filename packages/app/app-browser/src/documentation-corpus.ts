/**
 * Server-safe facade for documentation tooling. Keep it free of browser/runtime
 * modules so Docusaurus config loading never evaluates the application barrel.
 *
 * The barrel is not merely heavy here, it is unloadable: it reaches
 * `virtual:pwa-register`, a module only a Vite app build provides. So anything
 * `apps/docs` needs as a **value** outside a browser bundle — the corpus build
 * plugin, and the #477 documentation tools' unit tests — has to come through
 * this door rather than through `@tinytinkerer/app-browser`.
 */
export { DOCUMENTATION_CORPUS_SCHEMA_VERSION } from '@tinytinkerer/contracts'
/**
 * The transport's per-message ceiling, which `clampChatMessageContent` applies
 * to every outgoing chat message including a tool result.
 *
 * It lives beside the corpus contracts because #477's documentation tools are
 * the consumer: a read response has to be *fitted* to this limit, or the
 * transport silently drops its tail and severs the outline and truncation
 * metadata from the Markdown they describe. Re-exported rather than copied so
 * the tools cannot drift from the real number.
 */
export { MAX_CHAT_MESSAGE_CONTENT_CHARS } from '@tinytinkerer/contracts'
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
