/**
 * Turn-activity presentation for the three documentation tools.
 *
 * These summarizers deliberately do **not** echo document content. The activity
 * timeline is a record of what happened, and a read can legitimately return
 * twenty thousand characters of Markdown; inlining it would bury the timeline
 * and duplicate what the answer already shows. Each view names the document,
 * what was selected from it, and how much was returned — enough to audit the
 * call, not a second copy of the page.
 */
import type { ActivitySummarizer, ActivityView } from '@tinytinkerer/app-browser'
import type { ReadCurrentDocOutput, SearchDocsOutput } from './schemas'

const errorView = (title: string, message: string, code: string): ActivityView => ({
  title,
  status: 'error',
  sections: [
    { kind: 'text', label: 'Code', value: code },
    { kind: 'text', label: 'Message', value: message }
  ]
})

export const summarizeSearchDocsActivity: ActivitySummarizer = (output): ActivityView => {
  const value = output as SearchDocsOutput | undefined
  if (!value || value.status !== 'ok') {
    return value
      ? errorView('Documentation search unavailable', value.message, value.code)
      : { title: 'Documentation search', status: 'unknown', sections: [] }
  }
  return {
    title: `Documentation search: "${value.query}"`,
    status: 'ok',
    sections: [
      { kind: 'text', label: 'Results', value: String(value.results.length) },
      ...value.results.map((result, index) => ({
        kind: 'text' as const,
        label: `${index + 1}. ${result.title}`,
        // The citation target and the section it matched — no snippet, which the
        // answer itself will surface if it matters.
        value: [result.permalink, result.section].filter(Boolean).join('\n')
      }))
    ]
  }
}

const SELECTION_LABEL: Record<string, string> = {
  full: 'whole document',
  balanced_overview: 'balanced overview',
  section: 'section'
}

const readView = (title: string, output: ReadCurrentDocOutput | undefined): ActivityView => {
  if (!output) return { title, status: 'unknown', sections: [] }

  if (output.status === 'not_on_doc_page') {
    return {
      title: `${title}: no current document`,
      status: 'warn',
      sections: [
        { kind: 'text', label: 'Route', value: output.pathname },
        { kind: 'text', label: 'Message', value: output.message }
      ]
    }
  }
  if (output.status === 'unavailable') {
    return {
      title: `${title}: unavailable`,
      status: 'error',
      sections: [
        { kind: 'text', label: 'Reason', value: output.reason },
        { kind: 'text', label: 'Route', value: output.pathname },
        { kind: 'text', label: 'Message', value: output.message }
      ]
    }
  }
  if (output.status === 'error') {
    return errorView(`${title}: failed`, output.message, output.code)
  }

  const { doc, truncation } = output
  return {
    title: `${title}: ${doc.title}`,
    status: 'ok',
    sections: [
      { kind: 'text', label: 'Page', value: doc.permalink },
      {
        kind: 'text',
        label: 'Selection',
        value: SELECTION_LABEL[output.selection] ?? output.selection
      },
      {
        kind: 'text',
        label: 'Returned',
        value: truncation.truncated
          ? `${truncation.returnedCharacterCount} of ${truncation.sourceCharacterCount} characters (${truncation.omittedCharacterCount} omitted)`
          : `${truncation.returnedCharacterCount} characters`
      }
    ]
  }
}

export const summarizeReadDocActivity: ActivitySummarizer = (output): ActivityView =>
  readView('Read documentation page', output as ReadCurrentDocOutput | undefined)

export const summarizeReadCurrentDocActivity: ActivitySummarizer = (output): ActivityView =>
  readView('Read current documentation page', output as ReadCurrentDocOutput | undefined)
