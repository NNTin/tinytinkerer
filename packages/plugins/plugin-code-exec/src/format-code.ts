import type { PluginReport } from '@tinytinkerer/contracts'
import { CODE_EXEC_PLUGIN_ID } from './plugin-id'

// Shared, view-agnostic formatting helpers for the run_javascript tool's `code`
// argument, reused by BOTH the permission prompt (permission-view.ts) and the
// activity timeline (index.ts) so the two surfaces format identically and the
// prettier wiring lives in exactly one place.
//
// DISPLAY ONLY: the formatted string is derived purely for the view. The runtime
// executes the original, byte-for-byte payload — nothing here ever feeds back into
// the tool input. Pure and React/DOM-free (enforced by scripts/check-boundaries.mjs):
// prettier/standalone is plain JS with no browser APIs, and it is imported lazily so
// it stays out of the eager plugin chunk.

// A `json` section payload. Structurally a member of both ActivityViewSection and
// PermissionViewSection, so the same value can be spread into either view's
// `sections` array without coupling this module to a specific view type.
export type JsonSection = { kind: 'json'; label: string; value: unknown }

// Builds the JSON section for every input field other than `code`, or nothing when
// there are no other fields.
export const otherInputFieldsSection = (input: Record<string, unknown>): JsonSection[] => {
  const rest = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'code'))
  return Object.keys(rest).length > 0 ? [{ kind: 'json', label: 'Input', value: rest }] : []
}

// Pretty-prints the source with the repo's own style so the displayed code reads
// like the rest of the codebase. prettier always appends a trailing newline; it is
// stripped so the view has no empty final line.
export const formatJavaScript = async (code: string): Promise<string> => {
  const [prettier, babelPlugin, estreePlugin] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    // The estree printer is required alongside the babel parser — babel produces an
    // ESTree-shaped AST this plugin knows how to print.
    import('prettier/plugins/estree')
  ])
  const formatted = await prettier.format(code, {
    parser: 'babel',
    plugins: [babelPlugin, estreePlugin],
    semi: false,
    singleQuote: true,
    trailingComma: 'none',
    printWidth: 100
  })
  return formatted.replace(/\n$/, '')
}

// Report attached when formatting fails so the host surfaces the parse/print bug
// with enough context to reproduce it (the offending source + the error message).
export const formatFailureReport = (code: string, error: unknown): PluginReport => ({
  pluginId: CODE_EXEC_PLUGIN_ID,
  kind: 'format_failure',
  level: 'warning',
  message: 'run_javascript code could not be formatted for display',
  contexts: {
    run_javascript_format_failure: {
      code,
      error: error instanceof Error ? error.message : String(error)
    }
  }
})
