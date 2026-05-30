import type { ContentDocument } from '@tinytinkerer/content-core'
import { parseMarkdownContent } from './parse-markdown-content'

export type MarkdownContentSnapshot = {
  source: string
  document: ContentDocument
}

export type MarkdownContentSession = {
  append: (chunk: string) => MarkdownContentSnapshot
  replace: (source: string) => MarkdownContentSnapshot
  snapshot: () => MarkdownContentSnapshot
}

export const createMarkdownContentSession = (
  initialSource = ''
): MarkdownContentSession => {
  let source = initialSource
  let document = parseMarkdownContent(source)

  const snapshot = (): MarkdownContentSnapshot => ({
    source,
    document
  })

  return {
    append(chunk) {
      source += chunk
      document = parseMarkdownContent(source)
      return snapshot()
    },
    replace(nextSource) {
      source = nextSource
      document = parseMarkdownContent(source)
      return snapshot()
    },
    snapshot
  }
}
