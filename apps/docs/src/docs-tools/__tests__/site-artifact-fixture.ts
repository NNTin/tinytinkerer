/**
 * Real document artifacts, built from this site's own authored Markdown.
 *
 * The #476 review's most generalizable finding was that a fictional corpus
 * cannot disagree with reality, so a green suite can coexist with an
 * implementation that contradicts the locked issue for a whole review cycle.
 * These fixtures therefore do not hand-write an artifact: they run this site's
 * real `docs/` files through the very `normalizeDocumentation` the #474 build
 * plugin uses, so an outline, a section boundary, an anchor, or a character
 * count that changes in the real corpus changes here too.
 *
 * The manifest side reuses `docs-page/__tests__/site-corpus-fixture.ts` — the
 * same `documentation-home`, `architecture/packages-concept`, and unlisted
 * `updates/PRIVACY-UPDATE` refs #476 pinned — extended with the oversized
 * `plugins-and-tools/plugin-infrastructure.md` this issue's balanced-overview
 * requirement is built around.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import type {
  DocumentationCorpusDocumentArtifact,
  DocumentationCorpusManifestEntry
} from '@tinytinkerer/app-browser/documentation-corpus'
import { DOCUMENTATION_CORPUS_SCHEMA_VERSION } from '@tinytinkerer/app-browser/documentation-corpus'
import { normalizeDocumentation } from '../../docs-corpus/normalize'
import { resetDocumentationArtifactStoreForTests } from '../../docs-corpus/artifact-store'
import { resetDocumentationCorpusStoreForTests } from '../../docs-corpus/manifest-store'
import { __resetGlobalData, __setPluginData } from '../../test/generated-global-data-stub'

export const SITE_CONFIG = { baseUrl: '/docs/', trailingSlash: true }

/**
 * Resolved from the workspace root rather than `import.meta.url`, matching
 * docs-corpus/__tests__/normalize.test.ts — Vite rewrites the module URL to a
 * `/@fs/...` form `fileURLToPath` cannot turn back into a path.
 */
const readAuthoredSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), '../../docs', relativePath), 'utf8')

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Exactly how build-corpus.ts serializes an artifact, trailing newline included. */
const serialize = (value: unknown): string => `${JSON.stringify(value)}\n`

export type SiteDocumentFixture = {
  entry: DocumentationCorpusManifestEntry
  artifact: DocumentationCorpusDocumentArtifact
  /** The exact bytes the artifact URL serves, which the store hashes. */
  bytes: string
}

/**
 * Builds a manifest entry and its artifact the same way the build does — same
 * normalization, same content hash over the normalized Markdown, same artifact
 * hash over the complete serialized bytes. That matters: the artifact store
 * verifies both, so a fixture that computed them differently would test the
 * store against a corpus the build could never produce.
 */
const buildFixture = (options: {
  ref: string
  source: string
  title: string
  permalink: string
  unlisted?: boolean
  version?: string
  isLast?: boolean
}): SiteDocumentFixture => {
  const authored = readAuthoredSource(options.source)
  const format = options.source.endsWith('.mdx') ? 'mdx' : 'md'
  const normalized = normalizeDocumentation(authored, options.title, format)
  const version = options.version ?? 'current'
  const contentHash = sha256(normalized.markdown)

  const artifact: DocumentationCorpusDocumentArtifact = {
    schemaVersion: DOCUMENTATION_CORPUS_SCHEMA_VERSION,
    ref: options.ref,
    version,
    contentHash,
    characterCount: normalized.markdown.length,
    markdown: normalized.markdown,
    outline: normalized.outline,
    sections: normalized.sections
  }
  const bytes = serialize(artifact)
  const artifactHash = sha256(bytes)

  return {
    artifact,
    bytes,
    entry: {
      ref: options.ref,
      version,
      versionPath: version === 'current' ? '/docs/' : `/docs/${version}/`,
      isLast: options.isLast ?? true,
      title: options.title,
      permalink: options.permalink,
      source: `@site/../../docs/${options.source}`,
      contentHash,
      artifactHash,
      unlisted: options.unlisted ?? false,
      artifact: `/docs/assets/docs-corpus/documents/${version}-${options.ref.replace(/[^a-z0-9]+/gi, '-')}.${artifactHash}.json`,
      characterCount: artifact.characterCount,
      sectionCount: artifact.sections.length
    }
  }
}

/** `docs/index.mdx` — the docs landing route this site authors (`slug: /`). */
export const LANDING = buildFixture({
  ref: 'documentation-home',
  source: 'index.mdx',
  title: 'TinyTinkerer documentation',
  permalink: '/docs/'
})

/** `docs/architecture/packages-concept.md` — an ordinary authored document. */
export const CANONICAL = buildFixture({
  ref: 'architecture/packages-concept',
  source: 'architecture/packages-concept.md',
  title: 'Packages Concept',
  permalink: '/docs/architecture/packages-concept/'
})

/** `docs/updates/PRIVACY-UPDATE.md` — authored `unlisted: true`, still readable. */
export const UNLISTED = buildFixture({
  ref: 'updates/PRIVACY-UPDATE',
  source: 'updates/PRIVACY-UPDATE.md',
  title: 'Privacy policy updated',
  permalink: '/docs/updates/PRIVACY-UPDATE/',
  unlisted: true
})

/**
 * `docs/plugins-and-tools/plugin-infrastructure.md` — the >54,000-character
 * document #477's balanced-overview requirement is written around, and the same
 * one `docs-corpus/__tests__/normalize.test.ts` already asserts the size of.
 */
export const OVERSIZED = buildFixture({
  ref: 'plugins-and-tools/plugin-infrastructure',
  source: 'plugins-and-tools/plugin-infrastructure.md',
  title: 'Plugin Infrastructure',
  permalink: '/docs/plugins-and-tools/plugin-infrastructure/'
})

const SITE_FIXTURES = [LANDING, CANONICAL, UNLISTED, OVERSIZED]

/**
 * Registers the guard that keeps these fixtures honest, in the same spirit as
 * `docs-page/__tests__/site-corpus-fixture.ts`. `readAuthoredSource` already
 * throws if a document is renamed or moved; these assertions catch the subtler
 * case where the file survives but the identity or the property under test does
 * not.
 */
export const assertFixtureStillMatchesSite = (): void => {
  it('is built from documents this site really authors', () => {
    const landing = readAuthoredSource('index.mdx')
    expect(landing).toMatch(/^id: documentation-home$/m)
    expect(landing).toMatch(/^slug: \/$/m)
    expect(readAuthoredSource('updates/PRIVACY-UPDATE.md')).toMatch(/^unlisted: true$/m)
    expect(readAuthoredSource('architecture/packages-concept.md')).not.toMatch(/^id:/m)

    // The premise of every balanced-overview test below. Asserted on the
    // authored bytes, matching docs-corpus/__tests__/normalize.test.ts.
    const oversized = readAuthoredSource('plugins-and-tools/plugin-infrastructure.md')
    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(54_000)
  })
}

const MANIFEST_PLUGIN = 'documentation-corpus'

/**
 * Publishes a corpus locator and serves the manifest plus these fixtures'
 * artifacts, exactly as a built site would.
 *
 * The manifest hash is recomputed the way `build-corpus.ts` computes it — over
 * `JSON.stringify({ schemaVersion, documents })` — because the runtime store
 * verifies it rather than trusting the locator, and an artifact's URL is served
 * with the very bytes its `artifactHash` was taken over. A fixture that faked
 * either would be testing the stores against a corpus no build could produce.
 *
 * An unexpected URL rejects rather than 404s, so a test that thinks it is
 * reading the corpus can never quietly be reading something else.
 */
export const installDocumentationCorpus = (
  fixtures: readonly SiteDocumentFixture[] = SITE_FIXTURES,
  overrides: Record<string, () => Promise<Response>> = {}
): { calls: string[]; manifestUrl: string } => {
  const documents = fixtures.map((fixture) => fixture.entry)
  const manifestHash = sha256(
    JSON.stringify({ schemaVersion: DOCUMENTATION_CORPUS_SCHEMA_VERSION, documents })
  )
  const manifestUrl = `/docs/assets/docs-corpus/manifest.v${DOCUMENTATION_CORPUS_SCHEMA_VERSION}.${manifestHash}.json`

  __setPluginData(MANIFEST_PLUGIN, 'default', {
    schemaVersion: DOCUMENTATION_CORPUS_SCHEMA_VERSION,
    manifestHash,
    manifestUrl
  })

  const bodies = new Map<string, string>([
    [
      manifestUrl,
      serialize({ schemaVersion: DOCUMENTATION_CORPUS_SCHEMA_VERSION, manifestHash, documents })
    ],
    ...fixtures.map((fixture) => [fixture.entry.artifact, fixture.bytes] as const)
  ])

  const calls: string[] = []
  // Both stores pass a plain URL string; `Request` would stringify to
  // `[object Object]` and silently miss every fixture, so it is rejected loudly.
  vi.stubGlobal('fetch', (input: string | URL) => {
    if (typeof input !== 'string' && !(input instanceof URL)) {
      return Promise.reject(new Error('documentation fetches must pass a URL string'))
    }
    const url = input.toString()
    calls.push(url)
    const override = overrides[url]
    if (override) return override()
    const body = bodies.get(url)
    if (body === undefined) return Promise.reject(new Error(`unexpected fetch for "${url}"`))
    return Promise.resolve(new Response(body, { status: 200 }))
  })

  return { calls, manifestUrl }
}

/** Clears everything `installDocumentationCorpus` and the two stores hold. */
export const resetDocumentationCorpus = (): void => {
  vi.unstubAllGlobals()
  __resetGlobalData()
  resetDocumentationCorpusStoreForTests()
  resetDocumentationArtifactStoreForTests()
}
