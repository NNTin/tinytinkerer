import { expect, type Page, type Route } from '@playwright/test'
import { SENTINEL_HOST } from './snippets'
// The REAL edge Hono worker, exercised in-process: every /api/* request the app
// makes is piped through `edgeApp.fetch` (see pipeToEdge), so the suite covers the
// edge worker — its routing, validation, CORS, anonymous-tier key provisioning,
// and the chat proxy — not just the frontend. ONLY LiteLLM (the upstream model
// provider) is mocked; auth (the run is anonymous) and rate limiting (disabled)
// are not under test. Importing from fixtures/ keeps it outside the boundary
// checker's src/ + tests/ scan, which is intentional — this is test wiring.
import { app as edgeApp } from '../../../apps/edge/src/index'

// A syntactically-valid https base URL that passes the edge's base-URL policy but
// is never really contacted: the edge's outbound calls to it are intercepted by a
// global fetch patch (see installLiteLLMUpstream).
const LITELLM_BASE_URL = 'https://litellm.mock'

// Edge bindings for the run: key-management configured so anonymous-tier key
// provisioning actually executes, all origins allowed, and every inbound
// rate-limit scope disabled (rate limiting is not under test).
const EDGE_ENV = {
  LITELLM_BASE_URL,
  LITELLM_ALLOWED_BASE_URLS: LITELLM_BASE_URL,
  LITELLM_KEY_MANAGEMENT_API_KEY: 'e2e-management-key',
  LITELLM_USER_KEY_SECRET: 'e2e-user-key-secret',
  ALLOW_ALL_ORIGINS: 'true',
  RATE_LIMIT_AUTH_MAX: '0',
  RATE_LIMIT_SEARCH_MAX: '0',
  RATE_LIMIT_MCP_MAX: '0'
}

// A subset of app-core's SandboxExecutionResult; `result` is whatever the
// adversarial snippet returned (surfaced through `LiteLLMMock.sandboxResult`).
type SandboxResult = {
  ok?: boolean
  result?: unknown
  logs?: unknown
  timedOut?: boolean
  error?: string
}

export type LiteLLMMock = {
  /** Raw chat-completion request bodies the edge forwarded to LiteLLM, in order. */
  requestBodies: () => string[]
  /**
   * The `SandboxExecutionResult` the runtime folded back into a later request's
   * ReAct observation, parsed out of the captured bodies (most recent first), or
   * `undefined` if the tool has not produced a result yet. Tests assert on the
   * parsed object (`.result`, `.timedOut`, …), not on substring soup.
   */
  sandboxResult: () => SandboxResult | undefined
  /** Number of ACTION decisions issued (run_javascript invocations requested). */
  actionCount: () => number
  /**
   * URLs of any request that actually reached the network for the exfiltration
   * sentinel host. A route fulfils these with 200, so a request only lands here if
   * the sandbox let it leave (CSP off); under `connect-src 'none'` the request is
   * blocked in the renderer and never reaches the route — a real egress oracle.
   */
  sentinelHits: () => string[]
}

type ChatMessage = { role: string; content: string }
type LiteLLMRequestBody = { stream?: boolean; messages?: ChatMessage[]; key?: unknown }

const OBSERVATION_PREFIX = 'run_javascript: '

// Parse the SandboxExecutionResult the runtime embedded in an observation. The
// "Tool results:" section is last in the message, so the tail after the final
// `run_javascript: ` is the result JSON (array-wrapped in the ReAct observation).
const parseSandboxResult = (text: string): SandboxResult | undefined => {
  const idx = text.lastIndexOf(OBSERVATION_PREFIX)
  if (idx === -1) return undefined
  const tail = text.slice(idx + OBSERVATION_PREFIX.length).trim()
  try {
    const parsed: unknown = JSON.parse(tail)
    const result: unknown = Array.isArray(parsed) ? (parsed as unknown[])[0] : parsed
    if (result && typeof result === 'object' && 'timedOut' in result) {
      return result as SandboxResult
    }
  } catch {
    /* not a complete JSON tail */
  }
  return undefined
}

// Emit the model content as several small SSE deltas (not one chunk) so the real
// streaming parser's cross-chunk buffering (`parseSseStream`) is exercised.
const sseStream = (content: string): string => {
  const size = 24
  let body = ''
  for (let i = 0; i < content.length; i += size) {
    body += `data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + size) } }] })}\n\n`
  }
  return body + 'data: [DONE]\n\n'
}

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

const FINAL_DECISION = JSON.stringify({
  kind: 'final',
  reasoning: 'The sandbox returned its result; ready to answer.'
})

const PLAN = JSON.stringify({
  complexity: 'low',
  steps: [
    { id: 'understand', summary: 'Understand the request' },
    { id: 'compose', summary: 'Compose the answer' }
  ]
})

// The synthesized final answer. Exported so a spec can wait for it to render
// (the DOM signal that a run actually completed) without duplicating the literal.
export const SYNTHESIS_ANSWER = 'Done — the sandbox finished executing the requested snippet.'

// How the mocked model resolves a ReAct decision:
//   • 'tool'    — issue a single `run_javascript` action (the sandbox suite path).
//   • 'no-tool' — finish immediately with no action, so a plain chat completes and
//                 synthesizes WITHOUT needing the code-exec tool (for suites where
//                 that tool stays disabled, e.g. the event-logger spec).
type ChatMode = 'tool' | 'no-tool'

// Per-run state, captured as the edge forwards chat requests to the LiteLLM mock.
type UpstreamState = {
  code: string
  mode: ChatMode
  bodies: string[]
  decoded: string[]
  actions: number
}

// The CONTENT-DRIVEN model behaviour, keyed off the request's system prompt so it
// is robust to call ordering (the default agent is ReAct: decide → act → decide →
// synthesize). The edge forwards `messages` verbatim, so the same detection that
// drove the old in-page mock now drives the mocked LiteLLM upstream.
const mockChatCompletion = (body: LiteLLMRequestBody, state: UpstreamState): Response => {
  state.bodies.push(JSON.stringify(body))
  const messages = Array.isArray(body.messages) ? body.messages : []
  state.decoded.push(messages.map((m) => m.content).join('\n'))
  const system = messages.find((m) => m.role === 'system')?.content ?? ''
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''

  let content: string
  if (system.startsWith('You are a ReAct agent')) {
    // In 'no-tool' mode there is no tool to drive, so finish on the first decision:
    // the run completes and synthesizes a plain answer without any action. A
    // completed tool result (folded into the next observation under "Tool
    // results:") is the deterministic signal to stop acting in 'tool' mode.
    if (
      state.mode === 'no-tool' ||
      lastUser.includes('Tool results:') ||
      lastUser.includes('Tool execution blocked:')
    ) {
      content = FINAL_DECISION
    } else {
      state.actions += 1
      content = JSON.stringify({
        kind: 'action',
        reasoning: 'Run the snippet in the sandbox to gather the observation.',
        toolId: 'run_javascript',
        input: { code: state.code }
      })
    }
  } else if (system.startsWith('You are a planning assistant')) {
    content = PLAN
  } else {
    content = SYNTHESIS_ANSWER
  }

  if (body.stream === true) {
    return new Response(sseStream(content), {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }
    })
  }
  return jsonResponse({
    id: 'mock-completion',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
  })
}

// The mocked LiteLLM upstream: the only external service the edge talks to. Covers
// the anonymous-tier key-management dance (/v2/key/info → /key/generate, which
// echoes the edge's deterministic key value), the models catalogue, and chat.
const mockLiteLLM = (
  url: string,
  init: RequestInit | undefined,
  state: UpstreamState
): Response => {
  const raw = typeof init?.body === 'string' ? init.body : ''
  const body = (raw ? JSON.parse(raw) : {}) as LiteLLMRequestBody
  if (url.endsWith('/v2/key/info')) return jsonResponse({ info: [] })
  if (url.endsWith('/key/generate')) return jsonResponse({ key: body.key })
  if (url.endsWith('/key/update')) return jsonResponse({})
  if (url.endsWith('/v1/models')) return jsonResponse({ data: [] })
  if (url.endsWith('/model/info')) return jsonResponse({ data: [] })
  if (url.endsWith('/v1/chat/completions')) return mockChatCompletion(body, state)
  return jsonResponse({})
}

// The active run's upstream state. Tests run serially (workers: 1), so a single
// module-level slot is safe; each installLiteLLMMock points it at a fresh run.
let activeUpstream: UpstreamState | null = null
let fetchPatched = false

const LITELLM_ORIGIN = new URL(LITELLM_BASE_URL).origin

// Exact-origin match (not a substring/prefix check, which would also match a
// hostname like `litellm.mock.evil.com`).
const isLiteLLMUrl = (url: string): boolean => {
  try {
    return new URL(url).origin === LITELLM_ORIGIN
  } catch {
    return false
  }
}

// Patch global fetch ONCE to intercept the edge's outbound LiteLLM calls. Anything
// not bound for the (never-resolvable) mock host falls through to the real fetch.
const installLiteLLMUpstream = (): void => {
  if (fetchPatched) return
  fetchPatched = true
  const realFetch = globalThis.fetch
  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (activeUpstream && isLiteLLMUrl(url)) {
      return Promise.resolve(mockLiteLLM(url, init, activeUpstream))
    }
    return realFetch(input, init)
  }
}

// Pipe a browser request through the real edge worker in-process and return its
// response to the page.
const pipeToEdge = async (route: Route): Promise<void> => {
  const request = route.request()
  const method = request.method()
  const init: RequestInit = { method, headers: await request.allHeaders() }
  const body = method === 'GET' || method === 'HEAD' ? null : request.postData()
  if (body !== null) init.body = body
  const edgeResponse = await edgeApp.fetch(new Request(request.url(), init), EDGE_ENV)
  const payload = Buffer.from(await edgeResponse.arrayBuffer())
  const responseHeaders: Record<string, string> = {}
  edgeResponse.headers.forEach((value, key) => {
    // Let Playwright recompute framing headers.
    if (key !== 'content-length' && key !== 'content-encoding') responseHeaders[key] = value
  })
  await route.fulfill({ status: edgeResponse.status, headers: responseHeaders, body: payload })
}

const installMock = async (page: Page, code: string, mode: ChatMode): Promise<LiteLLMMock> => {
  installLiteLLMUpstream()
  const state: UpstreamState = { code, mode, bodies: [], decoded: [], actions: 0 }
  activeUpstream = state
  const sentinelHits: string[] = []

  // Exfiltration sentinel: fulfil any request to the sentinel host with 200 and
  // record it. The sandbox's CSP blocks such a request in the renderer before it
  // reaches this route, so a hit means the sandbox actually leaked — a real egress
  // oracle, not a tautology (the sentinel host alone never resolves).
  await page.route(`**${SENTINEL_HOST}**`, (route) => {
    sentinelHits.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'LEAK' })
  })

  // Drive every edge route through the real edge worker.
  await page.route('**/api/**', (route) => pipeToEdge(route))
  await page.route('**/health', (route) => pipeToEdge(route))

  return {
    requestBodies: () => state.bodies,
    sandboxResult: () => {
      for (let i = state.decoded.length - 1; i >= 0; i -= 1) {
        const result = parseSandboxResult(state.decoded[i] ?? '')
        if (result) return result
      }
      return undefined
    },
    actionCount: () => state.actions,
    sentinelHits: () => sentinelHits
  }
}

// The sandbox suite's mock: the model issues a single `run_javascript` action so a
// real-browser sandbox run is driven (see installMock's 'tool' mode).
export const installLiteLLMMock = (page: Page, code: string): Promise<LiteLLMMock> =>
  installMock(page, code, 'tool')

// A NO-TOOL chat mock: the ReAct decision finishes immediately, so a plain message
// completes and synthesizes user.message + assistant.* events WITHOUT the code-exec
// tool. Used by suites (e.g. event-logger) that keep that tool disabled.
export const installChatMock = (page: Page): Promise<LiteLLMMock> =>
  installMock(page, '', 'no-tool')

// A telemetry-consent dialog auto-opens on first load and its overlay intercepts
// clicks. Decline it (keeps the run clean; telemetry no-ops in dev anyway).
export const dismissTelemetryDialog = async (page: Page): Promise<void> => {
  // The dialog appears after hydration (a beat after navigation), so wait for it
  // rather than racing the check.
  const decline = page.getByRole('button', { name: 'Continue without' })
  await decline.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  if (await decline.isVisible().catch(() => false)) {
    await decline.click()
    await expect(page.getByRole('dialog', { name: 'Telemetry' })).toBeHidden()
  }
}

// Opens Settings, enables the plugin whose Settings label is `label` (plugins are
// off by default), and closes the modal. The toggle's <input> is visually hidden
// (sr-only) but its accessible name comes from the wrapping <label> text, so we
// toggle via the label and read state via isChecked() (which works on hidden
// inputs). The label is also a substring of the checkbox's accessible name (the
// label text plus the plugin description share the wrapping <label>), so a single
// string locates both the click target and the checkbox.
export const enablePlugin = async (page: Page, label: string): Promise<void> => {
  await dismissTelemetryDialog(page)
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' })
  // The settings modal can already be open on first load; only open it if not.
  // Probe the dialog itself (not the "Close settings" label, which the backdrop
  // also carries) so the open/skip decision is unambiguous.
  if (!(await settingsDialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(settingsDialog).toBeVisible()
  }

  const labelText = page.getByText(label)
  await labelText.scrollIntoViewIfNeeded()
  const checkbox = page.getByRole('checkbox', { name: label })
  if (!(await checkbox.isChecked())) {
    await labelText.click()
  }
  await expect(checkbox).toBeChecked()

  // Close via the X button inside the dialog (the backdrop also carries the
  // "Close settings" label but sits behind the dialog content).
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Close settings' })
    .click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
}

// The Code execution plugin (run_javascript tool), enabled via its Settings label.
export const enableCodeExecPlugin = (page: Page): Promise<void> =>
  enablePlugin(page, 'Code execution (run_javascript tool)')

// The Event Logger plugin (its observer logs every chat event to the console),
// enabled via its Settings label (exactly `manifest.label`).
export const enableEventLoggerPlugin = (page: Page): Promise<void> =>
  enablePlugin(page, 'Event Logger (developer console)')

// The Permissions plugin (tool.beforeExecute gate that shows a confirmation
// modal), enabled via its Settings label (exactly `manifest.label`).
export const enablePermissionsPlugin = (page: Page): Promise<void> =>
  enablePlugin(page, 'Permissions (ask before tools run)')

// Sends a prompt and waits until the run has folded the sandbox result back into a
// follow-up request (i.e. the tool actually executed in a real browser sandbox).
// Then asserts exactly one action was issued — a guard that the action→final phase
// detection works, so a mis-detection can't silently burn the iteration budget.
export const runSnippetViaChat = async (page: Page, mock: LiteLLMMock): Promise<void> => {
  await page.getByPlaceholder('Ask anything').fill('Run the sandbox isolation check.')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect
    .poll(() => mock.sandboxResult() !== undefined, {
      timeout: 30_000,
      message: 'sandbox result was never folded back into a model request'
    })
    .toBe(true)
  expect(mock.actionCount(), 'exactly one run_javascript action should be issued').toBe(1)
}
