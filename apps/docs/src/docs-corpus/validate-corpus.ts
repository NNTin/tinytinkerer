import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY,
  serializeDocumentationCorpusAssets,
  type GeneratedDocumentationCorpus
} from './build-corpus'
import {
  documentationArtifactEntryProblem,
  documentationArtifactProblem
} from './artifact-invariants'
import { canonicalizeDocusaurusPermalink } from './docusaurus-compatibility'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const fail = (message: string): never => {
  throw new Error(`documentation corpus invariant failed: ${message}`)
}

const required = <Value>(value: Value | undefined, message: string): Value => {
  if (value === undefined) {
    throw new Error(`documentation corpus invariant failed: ${message}`)
  }
  return value
}

export const validateNoHiddenAuthorComments = (ref: string, markdown: string): void => {
  let fence: { marker: string; length: number } | undefined
  const visibleMarkdown = markdown
    .split('\n')
    .map((line) => {
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
      if (fenceMatch) {
        if (!fence) {
          fence = { marker: fenceMatch[0] ?? '', length: fenceMatch.length }
        } else if (
          fenceMatch[0] === fence.marker &&
          fenceMatch.length >= fence.length &&
          line.slice(line.indexOf(fenceMatch) + fenceMatch.length).trim() === ''
        ) {
          fence = undefined
        }
        return ''
      }
      return fence ? '' : line.replace(/(`+).*?\1/g, '')
    })
    .join('\n')
  const withoutHeadingComments = visibleMarkdown
    .replace(/^#{1,6} .*?<!--\s*#[^\s]+(?:\s.*?)?-->\s*$/gm, '')
    .replace(/^#{1,6} .*?\{\/\*\s*#[^\s*]+(?:\s.*?)?\*\/\}\s*$/gm, '')
  if (withoutHeadingComments.includes('<!--') || withoutHeadingComments.includes('{/*')) {
    fail(`${ref} contains a hidden author comment`)
  }
}

export const validateDocumentationCorpusInvariants = (
  corpus: GeneratedDocumentationCorpus,
  options: { baseUrl: string; trailingSlash: boolean | undefined }
): void => {
  const identities = new Set<string>()
  const canonicalVersions = new Set<string>()

  for (const entry of corpus.manifest.documents) {
    const identity = `${entry.version}\0${entry.ref}`
    if (identities.has(identity)) fail(`duplicate identity ${entry.version}/${entry.ref}`)
    identities.add(identity)
    if (entry.isLast) canonicalVersions.add(entry.version)

    const canonicalPermalink = canonicalizeDocusaurusPermalink(entry.permalink, options)
    if (entry.permalink !== canonicalPermalink) fail(`${identity} has a non-canonical permalink`)
    const canonicalVersionPath = canonicalizeDocusaurusPermalink(entry.versionPath, options)
    if (entry.versionPath !== canonicalVersionPath)
      fail(`${identity} has a non-canonical versionPath`)

    const artifactRelativePath = entry.artifact.split(
      `/${DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY}/`
    )[1]
    const artifact = required(
      artifactRelativePath ? corpus.artifacts.get(artifactRelativePath) : undefined,
      `${identity} points to a missing artifact`
    )
    const entryProblem = documentationArtifactEntryProblem(entry, artifact)
    if (entryProblem) fail(`${identity} artifact ${entryProblem.message}`)

    const artifactBytes = serializeDocumentationCorpusAssets(corpus).get(artifactRelativePath)
    if (!artifactBytes || sha256(artifactBytes) !== entry.artifactHash) {
      fail(`${identity} artifactHash does not match serialized bytes`)
    }
    if (sha256(artifact.markdown) !== entry.contentHash) {
      fail(`${identity} contentHash does not match normalized Markdown`)
    }

    // The same semantic invariants the runtime artifact store enforces, from the
    // one shared implementation — so a corpus that would be rejected in the
    // browser cannot pass the build.
    const semantic = documentationArtifactProblem(artifact)
    if (semantic) fail(`${identity} artifact ${semantic}`)
    validateNoHiddenAuthorComments(identity, artifact.markdown)
  }

  const expectedManifestHash = sha256(
    JSON.stringify({
      schemaVersion: corpus.manifest.schemaVersion,
      documents: corpus.manifest.documents
    })
  )
  if (
    corpus.manifest.manifestHash !== expectedManifestHash ||
    corpus.locator.manifestHash !== expectedManifestHash ||
    !corpus.locator.manifestUrl.endsWith(`/${corpus.manifestFileName}`)
  ) {
    fail('manifest hash or locator does not match the canonical manifest payload')
  }

  if (canonicalVersions.size !== 1) {
    fail(`expected one isLast version, found ${canonicalVersions.size}`)
  }
}

const decodeHtmlAttribute = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )

const htmlAttribute = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`\\s${name}=(["'])(.*?)\\1`, 'i').exec(tag)
  return match?.[2] ? decodeHtmlAttribute(match[2]) : undefined
}

const builtHtmlPath = (outDir: string, baseUrl: string, permalink: string): string => {
  const pathname = new URL(permalink, 'https://corpus.invalid').pathname
  const relativePath = pathname.startsWith(baseUrl)
    ? pathname.slice(baseUrl.length)
    : pathname.slice(1)
  if (!relativePath) return join(outDir, 'index.html')
  return pathname.endsWith('/')
    ? join(outDir, relativePath, 'index.html')
    : join(outDir, `${relativePath}.html`)
}

export const validateProductionDocumentationCorpus = async (
  outDir: string,
  corpus: GeneratedDocumentationCorpus,
  options: {
    baseUrl: string
    trailingSlash: boolean | undefined
    siteUrl: string
  }
): Promise<void> => {
  validateDocumentationCorpusInvariants(corpus, options)

  for (const [relativePath, expectedBytes] of serializeDocumentationCorpusAssets(corpus)) {
    const actualBytes = await readFile(
      join(outDir, DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY, relativePath),
      'utf8'
    )
    if (actualBytes !== expectedBytes) fail(`${relativePath} differs from canonical serialization`)
  }

  for (const entry of corpus.manifest.documents) {
    const html = await readFile(builtHtmlPath(outDir, options.baseUrl, entry.permalink), 'utf8')
    const canonicalTag = [...html.matchAll(/<link\b[^>]*>/gi)].find(
      ([tag]) => htmlAttribute(tag, 'rel') === 'canonical'
    )?.[0]
    const actualCanonical = canonicalTag ? htmlAttribute(canonicalTag, 'href') : undefined
    const expectedCanonical = new URL(entry.permalink, options.siteUrl).href
    if (actualCanonical !== expectedCanonical) {
      fail(
        `${entry.version}/${entry.ref} canonical link is ${String(actualCanonical)}, expected ${expectedCanonical}`
      )
    }

    const renderedIds = new Set(
      [...html.matchAll(/\sid=(["'])(.*?)\1/gi)].map((match) => decodeHtmlAttribute(match[2] ?? ''))
    )
    const artifactRelativePath = entry.artifact.split(
      `/${DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY}/`
    )[1]
    const artifact = required(
      artifactRelativePath ? corpus.artifacts.get(artifactRelativePath) : undefined,
      `${entry.version}/${entry.ref} artifact disappeared during validation`
    )
    for (const section of artifact.sections) {
      if (section.anchor !== null && !renderedIds.has(section.anchor)) {
        fail(`${entry.version}/${entry.ref} anchor ${section.anchor} does not exist in built HTML`)
      }
    }
  }
}
