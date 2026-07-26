import { resolve } from 'node:path'
import type { LoadedContent } from '@docusaurus/plugin-content-docs'
import type { LoadContext, Plugin } from '@docusaurus/types'
import {
  DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY,
  generateDocumentationCorpus,
  writeDocumentationCorpus,
  type DocumentationCorpusSource,
  type GeneratedDocumentationCorpus
} from './build-corpus'

const DOCS_PLUGIN_NAME = 'docusaurus-plugin-content-docs'
const DOCS_PLUGIN_ID = 'default'

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

/**
 * First-party Docusaurus plugin that derives the assistant corpus from the docs
 * plugin's loaded metadata. It deliberately emits no route or document-body
 * module: only a tiny manifest locator enters global data, while postBuild
 * writes hashed JSON assets for explicit read operations.
 */
export const documentationCorpusPlugin = (context: LoadContext): Plugin<unknown> => {
  let generatedCorpus: GeneratedDocumentationCorpus | undefined

  return {
    name: 'documentation-corpus',
    allContentLoaded: async ({ allContent, actions }) => {
      const docsContent = loadedDocsContent(allContent[DOCS_PLUGIN_NAME]?.[DOCS_PLUGIN_ID])
      const sources: DocumentationCorpusSource[] = docsContent.loadedVersions.flatMap((version) =>
        version.docs.map((doc) => ({
          id: doc.id,
          title: doc.title,
          permalink: doc.permalink,
          source: doc.source,
          draft: doc.draft,
          unlisted: doc.unlisted,
          absoluteSourcePath: resolveSourcePath(context.siteDir, doc.source)
        }))
      )
      generatedCorpus = await generateDocumentationCorpus(
        sources,
        `${context.baseUrl}${DOCUMENTATION_CORPUS_OUTPUT_DIRECTORY}`
      )
      actions.setGlobalData(generatedCorpus.locator)
    },
    postBuild: async ({ outDir }) => {
      if (!generatedCorpus) {
        throw new Error(
          'documentation corpus postBuild ran before Docusaurus loaded document metadata'
        )
      }
      await writeDocumentationCorpus(outDir, generatedCorpus)
    }
  }
}
