import {
  boundedPreview,
  PluginCaptureError,
  type ActivitySummarizer,
  type ActivityView,
  type ActivityViewSection,
  type AgentPlugin,
  type PluginHost,
  type PluginManifest,
  type PluginModule,
  type SandboxCodeExecutor,
  type SandboxExecutionResult,
  type Tool
} from '@tinytinkerer/contracts'
import { z } from 'zod'
import { CODE_EXEC_PLUGIN_ID } from './plugin-id'
import { formatFailureReport, formatJavaScript, otherInputFieldsSection } from './format-code'
import { summarizeCodeExecPermission } from './permission-view'

// Re-exported so existing importers keep their path; the constant itself lives in
// ./plugin-id to avoid an import cycle with ./permission-view.
export { CODE_EXEC_PLUGIN_ID }

// Upper bound on the source size this plugin will forward to the host. Caps the
// input early (before it ever reaches the sandbox) so an oversized payload fails
// as a clean validation error rather than stressing the executor. The host
// enforces the runtime caps (timeout, output size, concurrency) independently.
const MAX_CODE_BYTES = 1_000_000

// Sandbox execution budget requested by this tool. Deliberately BELOW the
// runtime's per-tool timeout (`toolTimeoutMs`, 10s in agent-runtime-base) so the
// sandbox's own timer fires first and resolves a graceful
// `{ ok: false, timedOut: true }` result the model can react to — instead of the
// runtime's generic `withTimeout` aborting the tool with "Tool run_javascript
// timed out" and discarding the timedOut signal. The host clamps this to its own
// HARD_TIMEOUT_MS ceiling, so requesting less only ever tightens the budget.
// Invariant: SANDBOX_TIMEOUT_MS + sandbox load/backstop slack < runtime toolTimeoutMs.
const SANDBOX_TIMEOUT_MS = 8_000

// Input contract for the run_javascript tool. `code` is the JavaScript source to
// run; `input` is an optional structured value (a JSON object or a top-level
// array) injected into the sandbox as a readonly `input` binding.
// Product-agnostic — no browser types leak here.
// Planner-facing prose lives on the schema (issue #287): the run_javascript tool
// descriptor's JSON Schema is generated from here, so these descriptions reach the
// model and cannot drift from the runtime contract.
export const codeExecInputSchema = z.object({
  code: z
    .string()
    .min(1, 'code must not be empty')
    .max(MAX_CODE_BYTES, `code must be at most ${MAX_CODE_BYTES} bytes`)
    .describe(
      'JavaScript source to run. It executes inside an async function body, so use ' +
        '`return <value>` to produce a result and `await` for promises. No network or ' +
        'storage; the live page is not readable, but the full sanitized DOM from the last ' +
        'read_dom call is available as the readonly `dom` binding.'
    ),
  input: z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .optional()
    .describe(
      'Optional JSON value (object or array) made available to the code as a readonly ' +
        '`input` binding.'
    )
})

export type CodeExecInput = z.infer<typeof codeExecInputSchema>

// Longest single value the summary will inline before truncating. Keeps a large
// result or error from flooding the activity panel — the full result is delivered
// to the model and rendered separately, so this preview only needs to be a hint.
const MAX_SUMMARY_VALUE = 120

// Bounds on the console output shown in the Logs section. A chatty run can emit
// thousands of lines; the panel only needs a hint, so cap both the line count and
// the total characters and mark when the view was clipped. The full logs still
// reach the model via the tool result.
const MAX_LOG_LINES = 20
const MAX_LOG_CHARS = 2_000

// Joins the captured console lines into a single bounded, multi-line string for the
// Logs section, appending an explicit marker when lines or characters were dropped
// so a reader can tell the view was clipped.
const previewLogs = (logs: unknown[]): string => {
  const lines = logs.map((line) =>
    typeof line === 'string' ? line : boundedPreview(line, MAX_SUMMARY_VALUE)
  )
  const droppedLines = lines.length - MAX_LOG_LINES
  let shown = (droppedLines > 0 ? lines.slice(0, MAX_LOG_LINES) : lines).join('\n')
  let suffix =
    droppedLines > 0 ? `\n… (${droppedLines} more line${droppedLines === 1 ? '' : 's'})` : ''
  if (shown.length > MAX_LOG_CHARS) {
    shown = `${shown.slice(0, MAX_LOG_CHARS)}…`
    suffix = suffix || '\n… (truncated)'
  }
  return `${shown}${suffix}`
}

// Builds the read-only `code` section for the call's `input.code`, pretty-printed
// with the shared formatter (so it matches the permission prompt). Fails open to
// the raw source plus a format-failure report rather than dropping the section, so
// the panel always shows what ran. Returns nothing when there is no string `code`
// (e.g. a malformed/legacy event) so the rest of the view still renders.
const codeSection = async (
  input: Record<string, unknown> | undefined
): Promise<{ section?: ActivityViewSection; report?: ActivityView['report'] }> => {
  const code = input?.code
  if (typeof code !== 'string' || code.length === 0) {
    return {}
  }
  try {
    const formatted = await formatJavaScript(code)
    return { section: { kind: 'code', label: 'Code', language: 'javascript', code: formatted } }
  } catch (error) {
    return {
      section: { kind: 'code', label: 'Code', language: 'javascript', code },
      report: formatFailureReport(code, error)
    }
  }
}

// Code-execution presentation owned by the plugin, not the host. Maps the call's
// raw input (the JS source) plus its SandboxExecutionResult
// (`{ ok, result, logs, timedOut, error? }`) to the host's product-agnostic
// ActivityView. A normal run is `ok` (green); a timeout is `warn` (the run was cut
// short, not a hard failure); a thrown error is `error`. The host pairs the status
// with a non-colour glyph+word cue, so `ok`/`timedOut`/error read without relying on
// colour. Async (it lazy-loads the shared pretty-printer) and React-free (enforced
// by scripts/check-boundaries.mjs) — the host renders text/json values as plain text
// and the `code` section read-only. Fixes the misleading "(no output)" the host's
// old MCP-shaped fallback showed for a successful run (issue #219, surfaced by #216).
export const summarizeCodeExecActivity: ActivitySummarizer = async (
  output,
  input
): Promise<ActivityView> => {
  const value = (output ?? {}) as Partial<SandboxExecutionResult>
  const logs = Array.isArray(value.logs) ? value.logs : []
  const timedOut = value.timedOut === true
  const ok = value.ok === true

  const { section: code, report } = await codeSection(input)

  const sections: ActivityViewSection[] = []
  if (code) {
    sections.push(code)
  }
  sections.push(...otherInputFieldsSection(input ?? {}))
  if (value.result !== undefined) {
    sections.push({
      kind: 'text',
      label: 'Result',
      value: boundedPreview(value.result, MAX_SUMMARY_VALUE)
    })
  }
  sections.push({
    kind: 'text',
    label: 'Logs',
    value: logs.length > 0 ? previewLogs(logs) : '(none)'
  })
  if (timedOut) {
    sections.push({ kind: 'text', label: 'Timed out', value: 'Execution exceeded the time limit' })
  }
  if (typeof value.error === 'string' && value.error.length > 0) {
    sections.push({
      kind: 'text',
      label: 'Error',
      value: boundedPreview(value.error, MAX_SUMMARY_VALUE)
    })
  }

  return {
    title: 'Ran JavaScript',
    status: timedOut ? 'warn' : ok ? 'ok' : 'error',
    sections,
    ...(report ? { report } : {})
  }
}

// UI + planner metadata for the host. The shape is the generic PluginManifest
// contract from contracts; this plugin ships its own copy and tool descriptor.
// No `defaultEnabled`, so it is OFF by default — the user opts in via Settings.
// `summarizeActivity` carries the plugin's own activity-panel presentation (see
// summarizeCodeExecActivity).
export const codeExecPluginManifest: PluginManifest = {
  id: CODE_EXEC_PLUGIN_ID,
  label: 'Code execution (run_javascript tool)',
  description:
    'Let the assistant run JavaScript in an isolated browser sandbox (an ephemeral, ' +
    'opaque-origin iframe + Worker with a strict content-security policy). The code ' +
    'cannot read the app, your storage, cookies, or the network, and it cannot reach ' +
    'this page. If the Browser state plugin is on, it can read the same already-redacted ' +
    'page snapshot that read_dom produces. Useful for calculations and data transforms. ' +
    'Off by default. Enable the Permissions plugin too if you want to approve each run ' +
    'before it executes.',
  starterPrompt: 'Help me debug this code.',
  toolDescriptors: [
    {
      id: 'run_javascript',
      description:
        'Run JavaScript in an isolated sandbox and get back its result plus console output. ' +
        'Use it for calculations, parsing, and data transforms where running code is more ' +
        'reliable than reasoning by hand. The sandbox has no network or storage access and ' +
        'cannot read the live page, BUT it receives the full sanitized page DOM from the most ' +
        'recent read_dom call as a readonly `dom` binding: a structured node tree rooted at ' +
        '<body> — { tag, id?, classes?, text?, attributes?, children? }, where `text` is the ' +
        "node's OWN direct text (concatenate `children` for a subtree's text). It is null if " +
        'read_dom has not run, and script/style content is omitted. Walk `dom` to ' +
        'count/search/extract across the whole page — read_dom gives only a narrow, truncated ' +
        'view, so heavy DOM work belongs here. ' +
        'End your code with a `return` (it runs inside an async function) or rely on console.log.',
      // Canonical schema (issue #287): the SAME Zod schema the tool validates against
      // (see createCodeExecTool). The host generates the planner-visible JSON Schema
      // from it; planner prose now lives on the schema's `.describe()` calls.
      schema: codeExecInputSchema,
      summarizeActivity: summarizeCodeExecActivity,
      summarizePermission: summarizeCodeExecPermission
    }
  ]
}

// Thrown when the host sandbox capability itself fails unexpectedly (the executor
// rejected rather than resolving with an `{ ok: false }` outcome). A normal failed
// run — a thrown user error or a timeout — is *not* this: it comes back as a
// resolved SandboxExecutionResult and is returned to the agent so the model can
// react to its own bad code. This carries a PluginReport so the registry routes it
// to the host capture sink (Sentry in the browser) and rethrows. Boundary-safe —
// uses only contracts' PluginCaptureError, no telemetry SDK.
export class CodeExecHostError extends PluginCaptureError {
  constructor(message: string) {
    super(
      {
        pluginId: CODE_EXEC_PLUGIN_ID,
        kind: 'host_error',
        level: 'error',
        // Only the failure message — never the user code, input, or any sandbox
        // output, so nothing executed leaks into telemetry.
        message: 'Sandbox executor failed'
      },
      message
    )
    this.name = 'CodeExecHostError'
  }
}

// Builds the run_javascript tool against the host's sandbox capability. The host
// owns the isolation boundary entirely; this tool only validates input and shapes
// the request/response. It stays product-agnostic — no browser APIs, no telemetry
// SDK, no app-browser imports.
const createCodeExecTool = (
  executeSandboxedCode: SandboxCodeExecutor
): Tool<CodeExecInput, SandboxExecutionResult> => ({
  id: 'run_javascript',
  description:
    'Run JavaScript in an isolated sandbox and return its result and console output. The ' +
    'full sanitized page DOM from the last read_dom call is available as the `dom` binding.',
  schema: codeExecInputSchema,
  async execute(input) {
    try {
      return await executeSandboxedCode({
        code: input.code,
        timeoutMs: SANDBOX_TIMEOUT_MS,
        ...(input.input ? { input: input.input } : {})
      })
    } catch (error) {
      // The executor should resolve with an `{ ok: false }` outcome for normal
      // failures; reaching here means the capability itself broke. Capture it and
      // surface a tool failure to the runtime.
      throw new CodeExecHostError(error instanceof Error ? error.message : 'unknown error')
    }
  }
})

// The code-execution plugin. Contributes a single run_javascript tool built
// against the host sandbox capability; needs no activate/deactivate lifecycle. A
// host without a sandbox capability simply gets no tool (the plugin tolerates the
// capability's absence rather than contributing a tool that cannot run).
export const codeExecPlugin = (): AgentPlugin => ({
  id: CODE_EXEC_PLUGIN_ID,
  createTools: (host: PluginHost): Tool<unknown, unknown>[] =>
    host.executeSandboxedCode ? [createCodeExecTool(host.executeSandboxedCode)] : []
})

// PluginModule contract surface: the named exports a host discovers dynamically.
export const manifest: PluginManifest = codeExecPluginManifest
export const createPlugin: PluginModule['createPlugin'] = codeExecPlugin
