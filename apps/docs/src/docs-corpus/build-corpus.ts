import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DocumentationCorpusDocumentArtifact,
  DocumentationCorpusLocator,
  DocumentationCorpusManifest,
  DocumentationCorpusManifestEntry
} from '@tinytinkerer/app-browser/documentation-corpus'
import { DOCUMENTATION_CORPUS_SCHEMA_VERSION } from '@tinytinkerer/app-browser/documentation-corpus'
import { normalizeDocumentation } from './normalize'

export const DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY = 'assets/docs-corpus'

export type DocumentationCorpusSource = {
  id: string
  version: string
  versionPath: string
  isLast: boolean
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

const artifactFileName = (version: string, ref: string, artifactHash: string): string => {
  const readableRef =
    `${version}-${ref}`
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'document'
  return `documents/${readableRef}.${sha256(`${version}:${ref}`).slice(0, 12)}.${artifactHash}.json`
}

export const generateDocumentationCorpus = async (
  sources: DocumentationCorpusSource[],
  publicBaseUrl: string
): Promise<GeneratedDocumentationCorpus> => {
  const artifacts = new Map<string, DocumentationCorpusDocumentArtifact>()
  const entries: DocumentationCorpusManifestEntry[] = []
  const seenIdentities = new Set<string>()

  for (const source of [...sources]
    .filter((item) => !item.draft)
    .sort((a, b) => a.version.localeCompare(b.version) || a.id.localeCompare(b.id))) {
    const identity = `${source.version}\0${source.id}`
    if (seenIdentities.has(identity)) {
      throw new Error(
        `documentation corpus contains duplicate Docusaurus identity "${source.version}/${source.id}"`
      )
    }
    seenIdentities.add(identity)

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
      version: source.version,
      contentHash,
      characterCount: normalized.markdown.length,
      markdown: normalized.markdown,
      outline: normalized.outline,
      sections: normalized.sections
    }
    const artifactHash = sha256(serialize(artifact))
    const fileName = artifactFileName(source.version, source.id, artifactHash)
    artifacts.set(fileName, artifact)
    entries.push({
      ref: source.id,
      version: source.version,
      versionPath: source.versionPath,
      isLast: source.isLast,
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

/** Exact relative output paths and bytes shared by build and development. */
export const serializeDocumentationCorpusAssets = (
  corpus: GeneratedDocumentationCorpus
): Map<string, string> =>
  new Map([
    [corpus.manifestFileName, serialize(corpus.manifest)],
    ...[...corpus.artifacts].map(([fileName, artifact]) => [fileName, serialize(artifact)] as const)
  ])

export const writeDocumentationCorpus = async (
  outDir: string,
  corpus: GeneratedDocumentationCorpus
): Promise<void> => {
  const corpusOutDir = join(outDir, DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY)
  await rm(corpusOutDir, { recursive: true, force: true })
  await mkdir(join(corpusOutDir, 'documents'), { recursive: true })
  await Promise.all(
    [...serializeDocumentationCorpusAssets(corpus)].map(([fileName, bytes]) =>
      writeFile(join(corpusOutDir, fileName), bytes, 'utf8')
    )
  )
}
