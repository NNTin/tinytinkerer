import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DocumentationCorpusDocumentArtifact,
  DocumentationCorpusLocator,
  DocumentationCorpusManifest,
  DocumentationCorpusManifestEntry,
  DocumentationCorpusSchemaVersion
} from '@tinytinkerer/app-browser'
import { normalizeDocumentation } from './normalize'

export const DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY = 'assets/docs-corpus'
const DOCUMENTATION_CORPUS_SCHEMA_VERSION = 1 satisfies DocumentationCorpusSchemaVersion

export type DocumentationCorpusSource = {
  id: string
  title: string
  permalink: string
  source: string
  draft: boolean
  unlisted: boolean
  absoluteSourcePath: string
}

export type GeneratedDocumentationCorpus = {
  manifest: DocumentationCorpusManifest
  manifestFileName: string
  locator: DocumentationCorpusLocator
  artifacts: Map<string, DocumentationCorpusDocumentArtifact>
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const serialize = (value: unknown): string => `${JSON.stringify(value)}\n`

const joinUrl = (...parts: string[]): string => {
  const [first = '', ...rest] = parts
  return `${first.replace(/\/+$/, '')}/${rest.map((part) => part.replace(/^\/+|\/+$/g, '')).join('/')}`
}

const artifactFileName = (ref: string, artifactHash: string): string => {
  const readableRef =
    ref
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'document'
  return `documents/${readableRef}.${sha256(ref).slice(0, 12)}.${artifactHash}.json`
}

export const generateDocumentationCorpus = async (
  sources: DocumentationCorpusSource[],
  publicBaseUrl: string
): Promise<GeneratedDocumentationCorpus> => {
  const artifacts = new Map<string, DocumentationCorpusDocumentArtifact>()
  const entries: DocumentationCorpusManifestEntry[] = []
  const seenRefs = new Set<string>()

  for (const source of [...sources]
    .filter((item) => !item.draft)
    .sort((a, b) => a.id.localeCompare(b.id))) {
    if (seenRefs.has(source.id)) {
      throw new Error(`documentation corpus contains duplicate Docusaurus ref "${source.id}"`)
    }
    seenRefs.add(source.id)

    const authoredSource = await readFile(source.absoluteSourcePath, 'utf8')
    const normalized = normalizeDocumentation(
      authoredSource,
      source.title,
      source.absoluteSourcePath.toLowerCase().endsWith('.mdx') ? 'mdx' : 'md'
    )
    const contentHash = sha256(normalized.markdown)
    const artifact: DocumentationCorpusDocumentArtifact = {
      schemaVersion: DOCUMENTATION_CORPUS_SCHEMA_VERSION,
      ref: source.id,
      contentHash,
      characterCount: normalized.markdown.length,
      markdown: normalized.markdown,
      outline: normalized.outline,
      sections: normalized.sections
    }
    const artifactHash = sha256(serialize(artifact))
    const fileName = artifactFileName(source.id, artifactHash)
    artifacts.set(fileName, artifact)
    entries.push({
      ref: source.id,
      title: source.title,
      permalink: source.permalink,
      source: source.source,
      contentHash,
      artifactHash,
      unlisted: source.unlisted,
      artifact: joinUrl(publicBaseUrl, fileName),
      characterCount: artifact.characterCount,
      sectionCount: artifact.sections.length
    })
  }

  const manifestHash = sha256(
    JSON.stringify({
      schemaVersion: DOCUMENTATION_CORPUS_SCHEMA_VERSION,
      documents: entries
    })
  )
  const manifest: DocumentationCorpusManifest = {
    schemaVersion: DOCUMENTATION_CORPUS_SCHEMA_VERSION,
    manifestHash,
    documents: entries
  }
  const manifestFileName = `manifest.v${DOCUMENTATION_CORPUS_SCHEMA_VERSION}.${manifestHash}.json`
  return {
    manifest,
    manifestFileName,
    locator: {
      schemaVersion: DOCUMENTATION_CORPUS_SCHEMA_VERSION,
      manifestHash,
      manifestUrl: joinUrl(publicBaseUrl, manifestFileName)
    },
    artifacts
  }
}

export const writeDocumentationCorpus = async (
  outDir: string,
  corpus: GeneratedDocumentationCorpus
): Promise<void> => {
  const corpusOutDir = join(outDir, DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY)
  await rm(corpusOutDir, { recursive: true, force: true })
  await mkdir(join(corpusOutDir, 'documents'), { recursive: true })
  await Promise.all([
    writeFile(join(corpusOutDir, corpus.manifestFileName), serialize(corpus.manifest), 'utf8'),
    ...[...corpus.artifacts].map(([fileName, artifact]) =>
      writeFile(join(corpusOutDir, fileName), serialize(artifact), 'utf8')
    )
  ])
}
