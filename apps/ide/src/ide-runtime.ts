import type {
  ActivitySummarizer,
  ActivityView,
  ActivityViewSection,
  Tool
} from '@tinytinkerer/app-browser'
import {
  createFileTools,
  ideControllerHandle,
  inspectRuntimeInputSchema,
  inspectWorkspaceInputSchema,
  restartRuntimeInputSchema,
  searchFilesInputSchema
} from '@tinytinkerer/ide'

const recordFrom = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const runtimeSections = (runtime: Record<string, unknown>): ActivityViewSection[] => {
  const sections: ActivityViewSection[] = [
    {
      kind: 'text',
      label: 'Status',
      value: typeof runtime.status === 'string' ? runtime.status : 'Unknown'
    }
  ]
  if (typeof runtime.error === 'string' && runtime.error.length > 0) {
    sections.push({ kind: 'text', label: 'Runtime error', value: runtime.error })
  }
  return sections
}

export const summarizeInspectWorkspaceActivity: ActivitySummarizer = (output): ActivityView => {
  const value = recordFrom(output)
  const runtime =
    typeof value.runtime === 'object' && value.runtime !== null && !Array.isArray(value.runtime)
      ? (value.runtime as Record<string, unknown>)
      : undefined
  const files = Array.isArray(value.files) ? value.files : undefined
  return {
    title: 'Inspected workspace',
    status:
      !runtime || !files
        ? 'error'
        : typeof runtime.error === 'string' && runtime.error.length > 0
          ? 'error'
          : 'ok',
    sections: [
      { kind: 'text', label: 'Files', value: files ? String(files.length) : 'Malformed result' },
      ...(runtime ? runtimeSections(runtime) : [])
    ]
  }
}

export const summarizeSearchFilesActivity: ActivitySummarizer = (output): ActivityView => {
  const value = recordFrom(output)
  const results = Array.isArray(value.results) ? value.results : undefined
  const truncated = value.truncated === true
  return {
    title: 'Searched files',
    status: !results ? 'error' : results.length === 0 || truncated ? 'warn' : 'ok',
    sections: [
      {
        kind: 'text',
        label: 'Matches',
        value: results ? String(results.length) : 'Malformed result'
      },
      ...(typeof value.query === 'string'
        ? [{ kind: 'text' as const, label: 'Query', value: value.query }]
        : []),
      ...(truncated
        ? [{ kind: 'text' as const, label: 'Partial result', value: 'Result limit reached' }]
        : [])
    ]
  }
}

export const summarizeInspectRuntimeActivity: ActivitySummarizer = (output): ActivityView => {
  const value = recordFrom(output)
  const hasStatus = typeof value.status === 'string'
  const hasError = typeof value.error === 'string' && value.error.length > 0
  return {
    title: 'Inspected runtime',
    status: !hasStatus || hasError ? 'error' : 'ok',
    sections: [
      ...runtimeSections(value),
      ...(Array.isArray(value.logs)
        ? [{ kind: 'text' as const, label: 'Log entries', value: String(value.logs.length) }]
        : [])
    ]
  }
}

export const summarizeRestartRuntimeActivity: ActivitySummarizer = (output): ActivityView => {
  const restarted = recordFrom(output).restarted === true
  return {
    title: 'Restarted runtime',
    status: restarted ? 'ok' : 'error',
    sections: [
      {
        kind: 'text',
        label: 'Restarted',
        value: restarted ? 'Yes' : 'No'
      }
    ]
  }
}

export const createIdeAppTools = (): Tool<unknown, unknown>[] => [
  {
    id: 'inspect_workspace',
    description: 'Inspect the browser IDE file tree, open files, revisions, and runtime status.',
    schema: inspectWorkspaceInputSchema,
    summarizeActivity: summarizeInspectWorkspaceActivity,
    execute: (input) => ideControllerHandle.request('inspectWorkspace', input)
  },
  {
    id: 'search_files',
    description:
      'Search file paths and text in the browser IDE workspace before reading or editing.',
    schema: searchFilesInputSchema,
    summarizeActivity: summarizeSearchFilesActivity,
    execute: (input) => ideControllerHandle.request('searchFiles', input)
  },
  ...createFileTools(
    {
      readFiles: (input) => ideControllerHandle.request('readFiles', input),
      applyFileChanges: (input) => ideControllerHandle.request('applyFileChanges', input)
    },
    {
      readDescription:
        'Read exact IDE file contents and revisions. Read before applying versioned edits.',
      applyDescription:
        'Atomically create, replace, exact-edit, move, or delete IDE files. Existing files require the revision returned by the latest read_files call; conflicts reject the whole batch, so re-read affected files and recompute changes before retrying.'
    }
  ),
  {
    id: 'inspect_runtime',
    description:
      'Inspect the Sandpack compile/runtime status, current error, and recent console output.',
    schema: inspectRuntimeInputSchema,
    summarizeActivity: summarizeInspectRuntimeActivity,
    execute: (input) => ideControllerHandle.request('inspectRuntime', input)
  },
  {
    id: 'restart_runtime',
    description: 'Restart the browser IDE preview after inspecting a runtime problem.',
    schema: restartRuntimeInputSchema,
    summarizeActivity: summarizeRestartRuntimeActivity,
    execute: (input) => ideControllerHandle.request('restartRuntime', input)
  }
]
