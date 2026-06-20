import type {
  PermissionSummarizer,
  PermissionView,
  PermissionViewSection,
  PluginReport
} from '@tinytinkerer/contracts'
import { CODE_EXEC_PLUGIN_ID } from './plugin-id'

// Permission-prompt presentation owned by the plugin, not the host. Maps the
// run_javascript tool's raw permission-request input to a product-agnostic
// PermissionView the host renders in its confirmation prompt. This is the
// permissions counterpart to summarizeCodeExecActivity: the tool's owner decides
// how its `code` argument is shown (which field is code, the language, and how it
// is pretty-printed), while the host owns the single generic renderer.
//
// DISPLAY ONLY: the formatted string is derived purely for the view. The runtime
// executes the original, byte-for-byte payload — this mapper never feeds anything
// back into the tool input. Pure and React/DOM-free (enforced by
// scripts/check-boundaries.mjs): prettier/standalone is plain JS with no browser
// APIs, and it is imported lazily so it stays out of the eager plugin chunk.

// Builds the JSON section for every input field other than `code`, or nothing when
// there are no other fields.
const otherFieldsSection = (input: Record<string, unknown>): PermissionViewSection[] => {
  const rest = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'code'))
  return Object.keys(rest).length > 0 ? [{ kind: 'json', label: 'Input', value: rest }] : []
}

// Pretty-prints the source with the repo's own style so the displayed code reads
// like the rest of the codebase. prettier always appends a trailing newline; it is
// stripped so the view has no empty final line.
const formatJavaScript = async (code: string): Promise<string> => {
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
const formatFailureReport = (code: string, error: unknown): PluginReport => ({
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

export const summarizeCodeExecPermission: PermissionSummarizer = async (
  input
): Promise<PermissionView> => {
  const code = input.code
  // The schema guarantees a string `code`, but tolerate anything else by falling
  // back to a plain JSON view rather than throwing inside the prompt.
  if (typeof code !== 'string') {
    return { sections: [{ kind: 'json', label: 'Input', value: input }] }
  }

  const others = otherFieldsSection(input)
  try {
    const formatted = await formatJavaScript(code)
    return {
      sections: [
        { kind: 'code', label: 'Code', language: 'javascript', code: formatted },
        ...others
      ]
    }
  } catch (error) {
    // Fail open: show the raw source (never block the prompt) and report the failure.
    return {
      sections: [{ kind: 'code', label: 'Code', language: 'javascript', code }, ...others],
      report: formatFailureReport(code, error)
    }
  }
}
