/**
 * Wire contracts for the authored documentation corpus.
 *
 * The corpus is emitted by the Docusaurus build and consumed as JSON by
 * documentation tools. Keep these declarations free of Docusaurus, React, and
 * filesystem types so browser and server consumers can share them.
 */
export const DOCUMENTATION_CORPUS_SCHEMA_VERSION = 1 as const

export type DocumentationCorpusSchemaVersion = typeof DOCUMENTATION_CORPUS_SCHEMA_VERSION

export type DocumentationCorpusManifestEntry = {
  /** Docusaurus' canonical document id (the `metadata.id` active-doc exposes). */
  ref: string
  title: string
  /** Canonical, base-url-aware Docusaurus permalink. */
  permalink: string
  /** Docusaurus source identity, normally an `@site/...` path. */
  source: string
  /** SHA-256 of the normalized authored Markdown. */
  contentHash: string
  unlisted: boolean
  /** Absolute, base-url-aware URL of the independently loadable JSON artifact. */
  artifact: string
  characterCount: number
  sectionCount: number
}

export type DocumentationCorpusManifest = {
  schemaVersion: DocumentationCorpusSchemaVersion
  /** SHA-256 of the canonical manifest payload (before this field is added). */
  manifestHash: string
  documents: DocumentationCorpusManifestEntry[]
}

/**
 * The only corpus data placed in Docusaurus global data. Document bodies and
 * even the manifest remain fetch-on-demand static assets.
 */
export type DocumentationCorpusLocator = {
  schemaVersion: DocumentationCorpusSchemaVersion
  manifestHash: string
  manifestUrl: string
}

export type DocumentationCorpusSection = {
  /** Zero-based stable position in the artifact. Section zero is the document. */
  index: number
  /** Null for the synthetic whole-document section. */
  anchor: string | null
  title: string
  /** Markdown heading depth; zero identifies the whole-document section. */
  depth: number
  /** Nearest containing authored heading, or null for top-level sections. */
  parentAnchor: string | null
  /** Inclusive UTF-16 offset in `markdown`. */
  startOffset: number
  /** First UTF-16 offset after the heading itself. */
  contentStartOffset: number
  /** Exclusive UTF-16 offset, including all descendant subsections. */
  endOffset: number
  characterCount: number
}

export type DocumentationCorpusOutlineItem = {
  anchor: string
  title: string
  depth: number
  sectionIndex: number
  children: DocumentationCorpusOutlineItem[]
}

export type DocumentationCorpusDocumentArtifact = {
  schemaVersion: DocumentationCorpusSchemaVersion
  ref: string
  contentHash: string
  characterCount: number
  markdown: string
  outline: DocumentationCorpusOutlineItem[]
  sections: DocumentationCorpusSection[]
}

/**
 * Metadata a bounded read operation returns beside selected Markdown. It makes
 * truncation explicit instead of silently cutting a large document/section.
 */
export type DocumentationCorpusReadTruncation = {
  truncated: boolean
  sourceCharacterCount: number
  returnedCharacterCount: number
  omittedCharacterCount: number
  nextSectionAnchor: string | null
}

export type DocumentationCorpusLoadFailureCode =
  | 'manifest_unavailable'
  | 'manifest_invalid'
  | 'document_not_found'
  | 'document_unavailable'
  | 'document_invalid'
  | 'content_hash_mismatch'
  | 'section_not_found'

/** Serializable failure shape shared by future corpus loaders and tools. */
export type DocumentationCorpusLoadFailure = {
  ok: false
  kind: 'documentation_corpus_load_failure'
  code: DocumentationCorpusLoadFailureCode
  message: string
  retryable: boolean
  ref?: string
  artifact?: string
  section?: string
}
