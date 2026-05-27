import type { ContentSourcePlugin } from '@tinytinkerer/content-core'
import { createMarkdownContentSession } from './markdown-content-session'
import { parseMarkdownContent } from './parse-markdown-content'

export const markdownSourcePlugin: ContentSourcePlugin = {
  id: 'markdown',
  format: 'text/markdown',
  parse: parseMarkdownContent,
  createSession: createMarkdownContentSession
}
