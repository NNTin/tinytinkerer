import type { PermissionSummarizer, PermissionView } from '@tinytinkerer/contracts'
import { formatFailureReport, formatJavaScript, otherInputFieldsSection } from './format-code'

// Permission-prompt presentation owned by the plugin, not the host. Maps the
// run_javascript tool's raw permission-request input to a product-agnostic
// PermissionView the host renders in its confirmation prompt. This is the
// permissions counterpart to summarizeCodeExecActivity: the tool's owner decides
// how its `code` argument is shown (which field is code, the language, and how it
// is pretty-printed), while the host owns the single generic renderer. The shared
// pretty-printer lives in ./format-code so both views format identically.

export const summarizeCodeExecPermission: PermissionSummarizer = async (
  input
): Promise<PermissionView> => {
  const code = input.code
  // The schema guarantees a string `code`, but tolerate anything else by falling
  // back to a plain JSON view rather than throwing inside the prompt.
  if (typeof code !== 'string') {
    return { sections: [{ kind: 'json', label: 'Input', value: input }] }
  }

  const others = otherInputFieldsSection(input)
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
