import { resolve } from 'node:path'
import type { DocMetadata, LoadedContent, LoadedVersion } from '@docusaurus/plugin-content-docs'
import type { LoadContext, Plugin } from '@docusaurus/types'
import {
  DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY,
  generateDocumentationCorpus,
  serializeDocumentationCorpusAssets,
  type DocumentationCorpusSource,
  type GeneratedDocumentationCorpus
} from './build-corpus'
import { canonicalizeDocusaurusPermalink } from './docusaurus-compatibility'
import { validateProductionDocumentationCorpus } from './validate-corpus'

const DOCS_PLUGIN_NAME = 'docusaurus-plugin-content-docs'
const DOCS_PLUGIN_ID = 'default'

type CorpusVersionCandidate = {
  versionName: string
  isLast: boolean
}

/**
 * Corpus refs remain Docusaurus document ids. All versions are emitted and the
 * `(versionName, ref)` pair supplies the unique internal identity; this helper
 * identifies the version used for unqualified ref reads.
 */
export const selectCanonicalCorpusVersion = <Version extends CorpusVersionCandidate>(
  versions: readonly Version[]
): Version => {
  const canonicalVersions = versions.filter((version) => version.isLast)
  if (canonicalVersions.length !== 1 || !canonicalVersions[0]) {
    throw new Error(
      `documentation corpus requires exactly one Docusaurus isLast version, found ${canonicalVersions.length}`
    )
  }
  return canonicalVersions[0]
}

type WebpackCompiler = {
  webpack: {
    Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: number }
    sources: { RawSource: new (value: string) => unknown }
  }
  hooks: {
    thisCompilation: {
      tap: (
        name: string,
        handler: (compilation: {
          hooks: {
            processAssets: {
              tap: (options: { name: string; stage: number }, handler: () => void) => void
            }
          }
          emitAsset: (name: string, source: unknown) => void
        }) => void
      ) => void
    }
  }
}

class DocumentationCorpusAssetsPlugin {
  readonly #getCorpus: () => GeneratedDocumentationCorpus | undefined

  constructor(getCorpus: () => GeneratedDocumentationCorpus | undefined) {
    this.#getCorpus = getCorpus
  }

  apply(compilerValue: unknown): void {
    const compiler = compilerValue as WebpackCompiler
    const pluginName = 'DocumentationCorpusAssetsPlugin'
    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: pluginName,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
        },
        () => {
          const corpus = this.#getCorpus()
          if (!corpus) {
            throw new Error('documentation corpus assets requested before content was loaded')
          }
          for (const [relativePath, bytes] of serializeDocumentationCorpusAssets(corpus)) {
            compilation.emitAsset(
              `${DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY}/${relativePath}`,
              new compiler.webpack.sources.RawSource(bytes)
            )
          }
        }
      )
    })
  }
}

const loadedDocsContent = (value: unknown): LoadedContent => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('loadedVersions' in value) ||
    !Array.isArray(value.loadedVersions)
  ) {
    throw new Error(
      `documentation corpus could not find ${DOCS_PLUGIN_NAME}/${DOCS_PLUGIN_ID} loaded metadata`
    )
  }
  return value as LoadedContent
}

const resolveSourcePath = (siteDir: string, source: string): string => {
  if (!source.startsWith('@site/')) {
    throw new Error(`documentation corpus requires an @site source identity, received "${source}"`)
  }
  return resolve(siteDir, source.slice('@site/'.length))
}

type CorpusDocMetadata = Pick<DocMetadata, 'id' | 'title' | 'permalink' | 'source' | 'frontMatter'>
type CorpusLoadedVersion = Pick<LoadedVersion, 'versionName' | 'path' | 'isLast'> & {
  docs: CorpusDocMetadata[]
}

export const createDocumentationCorpusSources = (
  versions: readonly CorpusLoadedVersion[],
  options: {
    siteDir: string
    baseUrl: string
    trailingSlash: boolean | undefined
  }
): DocumentationCorpusSource[] => {
  selectCanonicalCorpusVersion(versions)
  const canonicalize = (permalink: string): string =>
    canonicalizeDocusaurusPermalink(permalink, {
      baseUrl: options.baseUrl,
      trailingSlash: options.trailingSlash
    })

  return versions.flatMap((version) =>
    version.docs.map((doc) => ({
      id: doc.id,
      version: version.versionName,
      versionPath: canonicalize(version.path),
      isLast: version.isLast,
      title: doc.title,
      permalink: canonicalize(doc.permalink),
      source: doc.source,
      // Docusaurus intentionally neutralizes these metadata fields in
      // development. Authored frontmatter is the environment-stable truth.
      draft: doc.frontMatter.draft === true,
      unlisted: doc.frontMatter.unlisted === true,
      absoluteSourcePath: resolveSourcePath(options.siteDir, doc.source)
    }))
  )
}

/**
 * First-party Docusaurus plugin that derives the assistant corpus from the docs
 * plugin's loaded metadata. It deliberately emits no route or document-body
 * module: only a tiny manifest locator enters global data, while the client
 * compiler emits hashed JSON assets for explicit reads in start and build.
 */
export const documentationCorpusPlugin = (context: LoadContext): Plugin<unknown> => {
  let generatedCorpus: GeneratedDocumentationCorpus | undefined

  return {
    name: 'documentation-corpus',
    allContentLoaded: async ({ allContent, actions }) => {
      const docsContent = loadedDocsContent(allContent[DOCS_PLUGIN_NAME]?.[DOCS_PLUGIN_ID])
      const sources = createDocumentationCorpusSources(docsContent.loadedVersions, {
        siteDir: context.siteDir,
        baseUrl: context.baseUrl,
        trailingSlash: context.siteConfig.trailingSlash
      })
      generatedCorpus = await generateDocumentationCorpus(
        sources,
        `${context.baseUrl}${DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY}`
      )
      actions.setGlobalData(generatedCorpus.locator)
    },
    configureWebpack: (_config, isServer) => {
      if (isServer) return
      return {
        plugins: [new DocumentationCorpusAssetsPlugin(() => generatedCorpus)]
      }
    },
    postBuild: async ({ outDir }) => {
      if (!generatedCorpus) {
        throw new Error(
          'documentation corpus postBuild ran before Docusaurus loaded document metadata'
        )
      }
      await validateProductionDocumentationCorpus(outDir, generatedCorpus, {
        baseUrl: context.baseUrl,
        trailingSlash: context.siteConfig.trailingSlash,
        siteUrl: context.siteConfig.url
      })
    }
  }
}
