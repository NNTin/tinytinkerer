import type {
  DocumentationCorpusOutlineItem,
  DocumentationCorpusSection
} from '@tinytinkerer/app-browser'
import { applyReplacements, collectReplacements, parseDocumentation } from './markdown-processing'
import { collectHeadings, createOutline, createSections, remapHeadings } from './section-boundaries'

export type NormalizedDocumentation = {
  markdown: string
  outline: DocumentationCorpusOutlineItem[]
  sections: DocumentationCorpusSection[]
}

/**
 * Convert authored Markdown/MDX into the deterministic, non-executable corpus
 * representation while deriving Docusaurus-compatible section boundaries.
 */
export const normalizeDocumentation = (
  authoredSource: string,
  documentTitle: string,
  format: 'md' | 'mdx' = 'mdx'
): NormalizedDocumentation => {
  const { source, tree } = parseDocumentation(authoredSource, format)
  const allHeadings = collectHeadings(tree, source)
  const preservedComments = new Set(
    allHeadings.flatMap((heading) =>
      heading.preservedComment
        ? [`${heading.preservedComment.start}:${heading.preservedComment.end}`]
        : []
    )
  )
  const replacements = collectReplacements(tree, source, preservedComments)
  const replaced = applyReplacements(source, replacements)
  const leadingWhitespace = /^\s*/.exec(replaced)?.[0].length ?? 0
  const trimmed = replaced.trim()
  const markdown = trimmed.length > 0 ? `${trimmed}\n` : ''
  const headings = remapHeadings(allHeadings, replacements, leadingWhitespace, markdown)

  return {
    markdown,
    outline: createOutline(headings),
    sections: createSections(documentTitle, markdown, headings)
  }
}
