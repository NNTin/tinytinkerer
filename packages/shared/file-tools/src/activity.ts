import type {
  ActivityStatus,
  ActivitySummarizer,
  ActivityView,
  ActivityViewSection
} from '@tinytinkerer/contracts'
import type { FileDiagnostic } from './contracts'

type DiagnosticLike = Partial<FileDiagnostic> & Record<string, unknown>

const diagnosticsFrom = (value: Record<string, unknown>): DiagnosticLike[] =>
  Array.isArray(value.diagnostics)
    ? value.diagnostics.filter(
        (entry): entry is DiagnosticLike =>
          typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      )
    : []

const statusForDiagnostics = (diagnostics: DiagnosticLike[]): ActivityStatus => {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return 'error'
  }
  return diagnostics.length > 0 ? 'warn' : 'ok'
}

const diagnosticSections = (diagnostics: DiagnosticLike[]): ActivityViewSection[] =>
  diagnostics.length === 0
    ? []
    : [
        {
          kind: 'text',
          label: 'Diagnostics',
          value: diagnostics
            .map((diagnostic) => {
              const location =
                typeof diagnostic.path === 'string'
                  ? `${diagnostic.path}${
                      typeof diagnostic.line === 'number' ? `:${diagnostic.line}` : ''
                    }`
                  : '(workspace)'
              const severity =
                diagnostic.severity === 'error'
                  ? 'error'
                  : diagnostic.severity === 'warning'
                    ? 'warning'
                    : 'diagnostic'
              const message =
                typeof diagnostic.message === 'string' ? diagnostic.message : '(no message)'
              return `${location} — ${severity}: ${message}`
            })
            .join('\n')
        }
      ]

const recordFrom = (output: unknown): Record<string, unknown> =>
  typeof output === 'object' && output !== null && !Array.isArray(output)
    ? (output as Record<string, unknown>)
    : {}

export const summarizeReadFilesActivity: ActivitySummarizer = (output): ActivityView => {
  const value = recordFrom(output)
  const files = Array.isArray(value.files) ? value.files : undefined
  const diagnostics = diagnosticsFrom(value)
  return {
    title: 'Read files',
    status: files ? statusForDiagnostics(diagnostics) : 'error',
    sections: [
      {
        kind: 'text',
        label: 'Files',
        value: files ? String(files.length) : 'Malformed result'
      },
      ...diagnosticSections(diagnostics)
    ]
  }
}

export const summarizeApplyFileChangesActivity: ActivitySummarizer = (output): ActivityView => {
  const value = recordFrom(output)
  const changes = Array.isArray(value.changes) ? value.changes : undefined
  const diagnostics = diagnosticsFrom(value)
  const sections: ActivityViewSection[] = [
    {
      kind: 'text',
      label: 'Changed',
      value: changes ? String(changes.length) : 'Malformed result'
    }
  ]
  if (typeof value.workspaceRevision === 'number') {
    sections.push({
      kind: 'text',
      label: 'Workspace revision',
      value: String(value.workspaceRevision)
    })
  }
  sections.push(...diagnosticSections(diagnostics))

  return {
    title: 'Applied file changes',
    status: changes ? statusForDiagnostics(diagnostics) : 'error',
    sections
  }
}
