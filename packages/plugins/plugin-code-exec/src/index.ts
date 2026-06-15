import {
  PluginCaptureError,
  type ActivitySummarizer,
  type ActivityView,
  type AgentPlugin,
  type PluginHost,
  type PluginManifest,
  type PluginModule,
  type SandboxCodeExecutor,
  type SandboxExecutionResult,
  type Tool
} from '@tinytinkerer/agent-core'
import { z } from 'zod'

// Stable id used as the activation key and the contributed tool id. Must match
// the manifest id surfaced in the Settings Modal.
export const CODE_EXEC_PLUGIN_ID = 'code-exec'

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
export const codeExecInputSchema = z.object({
  code: z
    .string()
    .min(1, 'code must not be empty')
    .max(MAX_CODE_BYTES, `code must be at most ${MAX_CODE_BYTES} bytes`),
  input: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional()
})

export type CodeExecInput = z.infer<typeof codeExecInputSchema>

// Longest single value the summary will inline before truncating. Keeps a large
// result or error from flooding the activity panel — the full result is delivered
// to the model and rendered separately, so this preview only needs to be a hint.
const MAX_SUMMARY_VALUE = 120

// Renders an arbitrary sandbox value as a short, plain-text preview. The host
// renders ActivityView values as text (never HTML), so this only needs to be a
// safe, bounded string. Non-serializable values fall back to String().
const previewValue = (value: unknown): string => {
  let text: string
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value) ?? String(value)
    } catch {
      text = String(value)
    }
  }
  return text.length > MAX_SUMMARY_VALUE ? `${text.slice(0, MAX_SUMMARY_VALUE)}…` : text
}

// Code-execution presentation owned by the plugin, not the host. Maps the
// SandboxExecutionResult (`{ ok, result, logs, timedOut, error? }`) to the host's
// product-agnostic ActivityView. A normal run is `ok` (green); a timeout is `warn`
// (the run was cut short, not a hard failure); a thrown error is `error`. Pure and
// React-free (enforced by scripts/check-boundaries.mjs) — the host renders the
// returned values as plain text. Fixes the misleading "(no output)" the host's old
// MCP-shaped fallback showed for a successful run (issue #219, surfaced by #216).
export const summarizeCodeExecActivity: ActivitySummarizer = (output): ActivityView => {
  const value = (output ?? {}) as Partial<SandboxExecutionResult>
  const logs = Array.isArray(value.logs) ? value.logs : []
  const timedOut = value.timedOut === true
  const ok = value.ok === true

  const sections: ActivityView['sections'] = []
  if (value.result !== undefined) {
    sections.push({ label: 'Result', value: previewValue(value.result) })
  }
  sections.push({ label: 'Logs', value: `${logs.length} line${logs.length === 1 ? '' : 's'}` })
  if (timedOut) {
    sections.push({ label: 'Timed out', value: 'Execution exceeded the time limit' })
  }
  if (typeof value.error === 'string' && value.error.length > 0) {
    sections.push({ label: 'Error', value: previewValue(value.error) })
  }

  return {
    title: 'Ran JavaScript',
    status: timedOut ? 'warn' : ok ? 'ok' : 'error',
    sections
  }
}

// UI + planner metadata for the host. The shape is the generic PluginManifest
// contract from agent-core; this plugin ships its own copy and tool descriptor.
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
    'this page. Useful for calculations and data transforms. Off by default. Enable ' +
    'the Permissions plugin too if you want to approve each run before it executes.',
  capabilities: ['tools'],
  toolDescriptors: [
    {
      id: 'run_javascript',
      description:
        'Run JavaScript in an isolated sandbox and get back its result plus console output. ' +
        'Use it for calculations, parsing, and data transforms where running code is more ' +
        'reliable than reasoning by hand. The sandbox has no network, DOM, or storage access. ' +
        'End your code with a `return` (it runs inside an async function) or rely on console.log.',
      inputSchema: {
        code: {
          type: 'string',
          description:
            'JavaScript source to run. It executes inside an async function body, so use ' +
            '`return <value>` to produce a result and `await` for promises. No DOM, network, ' +
            'or storage is available.'
        },
        input: {
          type: 'object',
          description:
            'Optional JSON value (object or array) made available to the code as a readonly ' +
            '`input` binding.'
        }
      },
      summarizeActivity: summarizeCodeExecActivity
    }
  ]
}

// Thrown when the host sandbox capability itself fails unexpectedly (the executor
// rejected rather than resolving with an `{ ok: false }` outcome). A normal failed
// run — a thrown user error or a timeout — is *not* this: it comes back as a
// resolved SandboxExecutionResult and is returned to the agent so the model can
// react to its own bad code. This carries a PluginReport so the registry routes it
// to the host capture sink (Sentry in the browser) and rethrows. Boundary-safe —
// uses only agent-core's PluginCaptureError, no telemetry SDK.
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
  description: 'Run JavaScript in an isolated sandbox and return its result and console output.',
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
