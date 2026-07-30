/**
 * Public surface of the documentation tools (issue #477).
 *
 * #479 imports `createDocumentationToolGroup` to attach the tools to the
 * assistant `BrowserApp`. Nothing outside this directory should reach for the
 * read pipeline, the selection engine, or the schemas' internals.
 */
export {
  createDocumentationToolGroup,
  DOCUMENTATION_TOOL_GROUP_ID,
  READ_CURRENT_DOC_TOOL_ID,
  READ_DOC_TOOL_ID,
  SEARCH_DOCS_TOOL_ID
} from './tools'
export type { DocumentationToolDependencies } from './tools'
export type {
  ReadCurrentDocInput,
  ReadCurrentDocOutput,
  ReadDocInput,
  ReadDocOutput,
  SearchDocsInput,
  SearchDocsOutput
} from './schemas'
