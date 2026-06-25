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

// The single chat model the mock catalogue advertises. Its id matches the app's
// default selected model so the context-usage gauge can resolve its limits. The
// context window + the prompt-token usage the stream reports are chosen so the
// gauge lands deterministically in the WARNING band (8000/10000 = 80%).
const MOCK_MODEL_ID = 'chatgpt/gpt-5.4'
export const MOCK_CONTEXT_WINDOW = 10_000
export const MOCK_PROMPT_TOKENS = 8_000
export const MOCK_CONTEXT_PERCENT = Math.round((MOCK_PROMPT_TOKENS / MOCK_CONTEXT_WINDOW) * 100)

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

// The choice-prompt tool's result (issue #85), folded back as a `tool` message and
// surfaced through `LiteLLMMock.choiceResult`.
type ChoiceResult = { kind?: string; value?: unknown; text?: unknown }

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
   * The `ChoicePromptResult` the runtime folded back into a later request's tool
   * result message (issue #85), parsed out of the captured bodies (most recent
   * first), or `undefined` if the choice prompt has not been answered yet. Lets a
   * test assert the user's selection (`{ kind: 'option', value }` / `'custom'` /
   * `'dismissed'`) re-entered the model context. Mirrors `sandboxResult`.
   */
  choiceResult: () => ChoiceResult | undefined
  /**
   * URLs of any request that actually reached the network for the exfiltration
   * sentinel host. A route fulfils these with 200, so a request only lands here if
   * the sandbox let it leave (CSP off); under `connect-src 'none'` the request is
   * blocked in the renderer and never reaches the route — a real egress oracle.
   */
  sentinelHits: () => string[]
}

type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
type ChatMessage = {
  role: string
  // Native tool calling (issue #276): an assistant tool-call turn carries
  // `content: null` + `tool_calls`; a `tool` result turn carries `tool_call_id`.
  content?: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}
type LiteLLMRequestBody = {
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  messages?: ChatMessage[]
  tools?: unknown[]
  tool_choice?: unknown
  key?: unknown
}
type UpstreamCall = { path: string; authorization: string | null }

// Parse the SandboxExecutionResult the runtime fed back as a native `tool` result
// message (issue #276): each executed tool call produces a `role: 'tool'` turn
// whose `content` is the JSON-encoded tool output. Scan a forwarded request body
// for such a message carrying a sandbox result.
const parseSandboxResultFromBody = (body: LiteLLMRequestBody): SandboxResult | undefined => {
  const messages = Array.isArray(body.messages) ? body.messages : []
  for (const message of messages) {
    if (message.role !== 'tool' || typeof message.content !== 'string') continue
    try {
      const parsed: unknown = JSON.parse(message.content)
      if (parsed && typeof parsed === 'object' && 'timedOut' in parsed) {
        return parsed as SandboxResult
      }
    } catch {
      /* a non-sandbox tool result (e.g. an "Error: …" blocked-tool message) */
    }
  }
  return undefined
}

// Parse the ChoicePromptResult the runtime fed back as a native `tool` result
// message (issue #85): the answered choice prompt produces a `role: 'tool'` turn
// whose `content` is the JSON-encoded `{ kind, … }` result. A dismissed/blocked turn
// is also valid JSON (`{ kind: 'dismissed' }`); only a `kind` discriminant is needed.
const parseChoiceResultFromBody = (body: LiteLLMRequestBody): ChoiceResult | undefined => {
  const messages = Array.isArray(body.messages) ? body.messages : []
  for (const message of messages) {
    if (message.role !== 'tool' || typeof message.content !== 'string') continue
    try {
      const parsed: unknown = JSON.parse(message.content)
      if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
        return parsed as ChoiceResult
      }
    } catch {
      /* a non-choice tool result (e.g. a sandbox result, or an "Error: …" message) */
    }
  }
  return undefined
}

// A re-pacing split point for the mermaid streaming spec. Keep the NUL bytes
// escaped so this TypeScript fixture remains text-diffable in Git/GitHub. When a
// synthesis answer carries this sentinel, `sseStream` drops it from the streamed
// text and emits an SSE comment line (`: tt-gate`) in its place. SSE comment lines
// (those not starting with `data: `) are ignored by the chat client's
// `parseSseStream`, so the marker is inert for every other suite; only the
// page-side re-pacer in tests/mermaid.e2e.ts looks for it, to hold part of the
// stream back and make the frontend's mid-stream (unclosed-fence) state observable.
// See packages/e2e/README.md.
export const GATE_SENTINEL = '\u0000__TT_GATE__\u0000'
const GATE_COMMENT = ': tt-gate'

// Emit the model content as several small SSE deltas (not one chunk) so the real
// streaming parser's cross-chunk buffering (`parseSseStream`) is exercised. A
// GATE_SENTINEL in the content is dropped from the deltas and replaced by an SSE
// comment marker — a re-pacing split point (see GATE_SENTINEL).
const sseStream = (content: string, usage?: { prompt_tokens: number }): string => {
  const size = 24
  const segments = content.split(GATE_SENTINEL)
  let body = ''
  segments.forEach((segment, index) => {
    if (index > 0) body += `${GATE_COMMENT}\n\n`
    for (let i = 0; i < segment.length; i += size) {
      body += `data: ${JSON.stringify({ choices: [{ delta: { content: segment.slice(i, i + size) } }] })}\n\n`
    }
  })
  // Mirror LiteLLM's `stream_options.include_usage`: a terminal chunk with an
  // empty `choices` array and a top-level `usage` block, before [DONE].
  if (usage) {
    body += `data: ${JSON.stringify({ choices: [], usage })}\n\n`
  }
  return body + 'data: [DONE]\n\n'
}

// A single plain-content SSE delta. Used to stream an OPTIONAL action-turn
// rationale before the tool call, for the spec that covers a model which DOES
// narrate its action (issue #276); the default action turn stays silent.
const sseContentDelta = (text: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`

// Stream a single native tool call as OpenAI-style SSE deltas (issue #276): the
// tool call's id + name arrive in the first delta and its arguments are split
// across two more so the client's cross-delta tool-call accumulation is exercised.
// By default no content is emitted — a non-reasoning model returns ONLY the tool
// call on an action turn, and the timeline then renders just the decision badge.
// An optional `preamble` models a model that narrates its action, streamed as
// ordinary content first (shown as the step's thought).
const sseToolCallStream = (toolCall: ToolCall, preamble?: string): string => {
  const index = 0
  const mid = Math.ceil(toolCall.function.arguments.length / 2)
  const deltas = [
    {
      tool_calls: [
        {
          index,
          id: toolCall.id,
          type: 'function',
          function: { name: toolCall.function.name, arguments: '' }
        }
      ]
    },
    { tool_calls: [{ index, function: { arguments: toolCall.function.arguments.slice(0, mid) } }] },
    { tool_calls: [{ index, function: { arguments: toolCall.function.arguments.slice(mid) } }] }
  ]
  let body = preamble ? sseContentDelta(preamble) : ''
  for (const delta of deltas) {
    body += `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`
  }
  return body + 'data: [DONE]\n\n'
}

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

// The single run_javascript tool call the mock issues in 'tool' mode (issue
// #276): native tool_calls now, not a hand-rolled JSON decision. The arguments
// are built per request from the snippet under test.
const runJavascriptToolCall = (code: string): ToolCall => ({
  id: 'call_run_javascript_1',
  type: 'function',
  function: { name: 'run_javascript', arguments: JSON.stringify({ code }) }
})

// The fixed choice poll the mock issues in 'ask' mode (issue #85). Exported so the
// choice-prompt spec asserts against the SAME question/options the model "asked",
// keeping the fixture the single source of truth.
export const CHOICE_QUESTION = 'Which colour do you prefer?'
export const CHOICE_OPTIONS = ['Red', 'Blue']

// The single ask_user tool call the mock issues in 'ask' mode (issue #85): a native
// tool call whose arguments are the choice poll the host renders.
const askUserToolCall = (): ToolCall => ({
  id: 'call_ask_user_1',
  type: 'function',
  function: {
    name: 'ask_user',
    arguments: JSON.stringify({
      question: CHOICE_QUESTION,
      options: CHOICE_OPTIONS,
      allowCustom: true
    })
  }
})

// The rationale the mock streams as ordinary `content` for the FINAL decision (the
// default model has no separate reasoning channel — its rationale IS the content).
// An ACTION turn emits NO content (a non-reasoning model returns only the tool
// call), so there is no action rationale to assert; the timeline derives that
// step's label from the call itself. Exported so the ReAct-timeline spec asserts
// the SAME text the model "reasoned", keeping the fixture the single source of
// truth (issue #276).
export const REACT_FINAL_REASONING = 'The sandbox returned its result; ready to answer.'

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
//   • 'ask'     — issue a single `ask_user` action (the choice-prompt suite path,
//                 issue #85), so a real-browser HITL poll is driven.
//   • 'no-tool' — finish immediately with no action, so a plain chat completes and
//                 synthesizes WITHOUT needing the code-exec tool (for suites where
//                 that tool stays disabled, e.g. the event-logger spec).
type ChatMode = 'tool' | 'ask' | 'no-tool'

// Per-run state, captured as the edge forwards chat requests to the LiteLLM mock.
type UpstreamState = {
  code: string
  mode: ChatMode
  // The synthesized final-answer content the mock streams back (per-test, so a
  // spec can stream e.g. a ```mermaid block instead of the default sentence).
  answer: string
  // Optional: when set, the ACTION turn narrates this rationale as ordinary
  // content before its tool call (models a model that explains its action). When
  // undefined the action turn is silent — the realistic non-reasoning default.
  actionReasoning?: string
  bodies: string[]
  actions: number
  provisionedKeys: Set<string>
  upstreamCalls: UpstreamCall[]
}

// The CONTENT-DRIVEN model behaviour, keyed off the request's system prompt so it
// is robust to call ordering (the default agent is ReAct: decide → act → decide →
// synthesize). The edge forwards `messages` verbatim, so the same detection that
// drove the old in-page mock now drives the mocked LiteLLM upstream.
const streamHeaders = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }

const mockChatCompletion = (body: LiteLLMRequestBody, state: UpstreamState): Response => {
  state.bodies.push(JSON.stringify(body))
  const messages = Array.isArray(body.messages) ? body.messages : []
  const system = messages.find((m) => m.role === 'system')?.content ?? ''

  if (system.startsWith('You are a ReAct agent')) {
    // Native tool calling (issue #276): the model now emits a real tool_call to
    // act, and answers with content to finish. In 'no-tool' mode there is no tool
    // to drive, so finish on the first decision. The deterministic signal to stop
    // acting in 'tool' mode is a `tool` result turn already present in the request
    // (covers both a completed sandbox run and a blocked/failed tool, each of
    // which the runtime replays as a `role: 'tool'` message).
    const hasToolResult = messages.some((m) => m.role === 'tool')
    if (state.mode === 'no-tool' || hasToolResult) {
      // Finish: answer with content and NO tool_calls (like a non-reasoning model);
      // its rationale IS the content. streamDecision treats the absence of a tool
      // call as the `final` decision and surfaces the content as the think text.
      if (body.stream === true) {
        return new Response(sseStream(REACT_FINAL_REASONING), {
          status: 200,
          headers: streamHeaders
        })
      }
      return jsonResponse({
        id: 'mock-completion',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: REACT_FINAL_REASONING },
            finish_reason: 'stop'
          }
        ]
      })
    }

    // Act: issue a single native run_javascript tool call. By default with NO
    // content preamble — how a non-reasoning model actually behaves on a tool turn
    // (only the tool call, no prose), so the timeline renders just the decision
    // badge. When the spec opted into narration, the rationale is emitted as
    // ordinary content first and shows as the step's thought (issue #276).
    state.actions += 1
    const toolCall = state.mode === 'ask' ? askUserToolCall() : runJavascriptToolCall(state.code)
    if (body.stream === true) {
      return new Response(sseToolCallStream(toolCall, state.actionReasoning), {
        status: 200,
        headers: streamHeaders
      })
    }
    return jsonResponse({
      id: 'mock-completion',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: state.actionReasoning ?? null,
            tool_calls: [toolCall]
          },
          finish_reason: 'tool_calls'
        }
      ]
    })
  }

  // Planner (plan-execute / hybrid): still a structured JSON ExecutionPlan — the
  // planner runs before any tool I/O, so it is untouched by the native tool-call
  // switch. Synthesis (any other system prompt): stream the final answer.
  const content = system.startsWith('You are a planning assistant') ? PLAN : state.answer

  if (body.stream === true) {
    // Emit a usage chunk only when the client opted in (synthesize does, the
    // ReAct decision calls do not) — the context-usage gauge reads it.
    const usage = body.stream_options?.include_usage
      ? { prompt_tokens: MOCK_PROMPT_TOKENS }
      : undefined
    return new Response(sseStream(content, usage), { status: 200, headers: streamHeaders })
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
const unauthorizedResponse = (path: string, reason: string): Response =>
  new Response(
    JSON.stringify({ error: `Unauthorized LiteLLM mock request to ${path}: ${reason}` }),
    {
      status: 401,
      headers: { 'content-type': 'application/json' }
    }
  )

const badRequestResponse = (path: string, reason: string): Response =>
  new Response(JSON.stringify({ error: `Bad LiteLLM mock request to ${path}: ${reason}` }), {
    status: 400,
    headers: { 'content-type': 'application/json' }
  })

const MANAGEMENT_AUTHORIZATION = `Bearer ${EDGE_ENV.LITELLM_KEY_MANAGEMENT_API_KEY}`
const knownProvisionedKeys = new Set<string>()

const mockLiteLLM = (
  url: string,
  init: RequestInit | undefined,
  state: UpstreamState
): Response => {
  const path = new URL(url).pathname
  const authorization = new Headers(init?.headers).get('authorization')
  state.upstreamCalls.push({ path, authorization })
  const raw = typeof init?.body === 'string' ? init.body : ''
  const body = (raw ? JSON.parse(raw) : {}) as LiteLLMRequestBody
  if (path === '/v2/key/info' || path === '/key/generate' || path === '/key/update') {
    if (authorization !== MANAGEMENT_AUTHORIZATION) {
      return unauthorizedResponse(path, 'expected the management API key')
    }
    if (path === '/v2/key/info') return jsonResponse({ info: [] })
    if (path === '/key/generate') {
      if (typeof body.key !== 'string' || body.key.trim().length === 0) {
        return badRequestResponse(path, 'expected the edge to supply a deterministic key')
      }
      state.provisionedKeys.add(body.key)
      knownProvisionedKeys.add(body.key)
      return jsonResponse({ key: body.key })
    }
    if (typeof body.key === 'string' && body.key.trim().length > 0) {
      state.provisionedKeys.add(body.key)
      knownProvisionedKeys.add(body.key)
    }
    return jsonResponse({})
  }

  if (path === '/v1/models' || path === '/model/info' || path === '/v1/chat/completions') {
    const key = authorization?.replace(/^Bearer\s+/i, '') ?? ''
    if (!state.provisionedKeys.has(key)) {
      return unauthorizedResponse(path, 'expected a provisioned per-run virtual key')
    }
    if (path === '/v1/models') {
      return jsonResponse({ data: [{ id: MOCK_MODEL_ID, object: 'model', owned_by: 'mock' }] })
    }
    if (path === '/model/info') {
      // Mirror LiteLLM's /model/info shape: model_info carries the token limits
      // the edge surfaces onto ModelEntry.limits for the gauge (issue #264).
      return jsonResponse({
        data: [
          {
            model_name: MOCK_MODEL_ID,
            model_info: {
              mode: 'chat',
              max_input_tokens: MOCK_CONTEXT_WINDOW,
              max_output_tokens: 4096
            }
          }
        ]
      })
    }
    return mockChatCompletion(body, state)
  }

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

const installMock = async (
  page: Page,
  code: string,
  mode: ChatMode,
  answer: string,
  actionReasoning?: string
): Promise<LiteLLMMock> => {
  installLiteLLMUpstream()
  const state: UpstreamState = {
    code,
    mode,
    answer,
    ...(actionReasoning !== undefined ? { actionReasoning } : {}),
    bodies: [],
    actions: 0,
    provisionedKeys: new Set(knownProvisionedKeys),
    upstreamCalls: []
  }
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
      for (let i = state.bodies.length - 1; i >= 0; i -= 1) {
        const raw = state.bodies[i]
        if (!raw) continue
        try {
          const result = parseSandboxResultFromBody(JSON.parse(raw) as LiteLLMRequestBody)
          if (result) return result
        } catch {
          /* a non-JSON body never carries a tool result */
        }
      }
      return undefined
    },
    actionCount: () => state.actions,
    choiceResult: () => {
      for (let i = state.bodies.length - 1; i >= 0; i -= 1) {
        const raw = state.bodies[i]
        if (!raw) continue
        try {
          const result = parseChoiceResultFromBody(JSON.parse(raw) as LiteLLMRequestBody)
          if (result) return result
        } catch {
          /* a non-JSON body never carries a tool result */
        }
      }
      return undefined
    },
    sentinelHits: () => sentinelHits
  }
}

// The sandbox suite's mock: the model issues a single `run_javascript` action so a
// real-browser sandbox run is driven (see installMock's 'tool' mode). The action
// turn is silent by default (realistic non-reasoning model).
export const installLiteLLMMock = (page: Page, code: string): Promise<LiteLLMMock> =>
  installMock(page, code, 'tool', SYNTHESIS_ANSWER)

// Like installLiteLLMMock, but the model NARRATES its action: the given rationale
// is streamed as ordinary content before the tool call, so the timeline shows it
// as the action step's thought. Covers the prose-narration path (issue #276).
export const installNarratedToolMock = (
  page: Page,
  code: string,
  actionReasoning: string
): Promise<LiteLLMMock> => installMock(page, code, 'tool', SYNTHESIS_ANSWER, actionReasoning)

// The choice-prompt suite's mock (issue #85): the model issues a single `ask_user`
// action so a real-browser HITL poll is driven and its answer folds back. The action
// turn is silent (realistic non-reasoning model), and the run finishes once the
// answer (or a dismissal) is present as a `tool` result.
export const installChoicePromptMock = (page: Page): Promise<LiteLLMMock> =>
  installMock(page, '', 'ask', SYNTHESIS_ANSWER)

// A NO-TOOL chat mock: the ReAct decision finishes immediately, so a plain message
// completes and synthesizes user.message + assistant.* events WITHOUT the code-exec
// tool. Used by suites (e.g. event-logger) that keep that tool disabled. The
// synthesized answer defaults to SYNTHESIS_ANSWER but can be overridden per test
// (e.g. the mermaid spec streams a ```mermaid block).
export const installChatMock = (
  page: Page,
  answer: string = SYNTHESIS_ANSWER
): Promise<LiteLLMMock> => installMock(page, '', 'no-tool', answer)

// A telemetry-consent dialog auto-opens on first load and its overlay intercepts
// clicks. Decline it (keeps the run clean; telemetry no-ops in dev anyway).
const telemetryHandledPages = new WeakSet<Page>()

export const dismissTelemetryDialog = async (page: Page): Promise<void> => {
  if (telemetryHandledPages.has(page)) return

  // The dialog appears after hydration (a beat after navigation), so wait for it
  // rather than racing the check.
  const decline = page.getByRole('button', { name: 'Continue without' })
  await decline.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  if (await decline.isVisible().catch(() => false)) {
    await decline.click()
    await expect(page.getByRole('dialog', { name: 'Telemetry' })).toBeHidden()
  }
  telemetryHandledPages.add(page)
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

  // The settings surface is tabbed: the control may live under any tab (plugins
  // under "Tools", interface prefs under "Models"), and only the active tab's
  // panel is mounted. Reveal the control by activating whichever tab renders it.
  const labelText = page.getByText(label)
  if (!(await labelText.isVisible().catch(() => false))) {
    const tabs = settingsDialog.getByRole('tab')
    const tabCount = await tabs.count()
    for (let index = 0; index < tabCount; index += 1) {
      await tabs.nth(index).click()
      if (await labelText.isVisible().catch(() => false)) {
        break
      }
    }
  }
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

// The Context usage gauge plugin (persistent gauge near the composer), enabled
// via its Settings label (exactly `manifest.label`).
export const enableContextUsagePlugin = (page: Page): Promise<void> =>
  enablePlugin(page, 'Context usage gauge')

// The Choice prompt plugin (ask_user human-in-the-loop tool), enabled via its
// Settings label (exactly `manifest.label`).
export const enableChoicePromptPlugin = (page: Page): Promise<void> =>
  enablePlugin(page, 'Choice prompt (ask you a question)')

// The Context inspector plugin (developer panel showing the exact forwarded
// request), enabled via its Settings label (exactly `manifest.label`).
export const enableContextInspectorPlugin = (page: Page): Promise<void> =>
  enablePlugin(page, 'Context inspector (developer)')

// The Reasoning & Activity timeline (the inline per-turn panel). Not a plugin but
// an Interface setting toggle, exposed through the same Settings ToggleRow flow as
// the plugins, so the shared enablePlugin helper drives it by its toggle label.
export const enableReasoningActivity = (page: Page): Promise<void> =>
  enablePlugin(page, 'Show reasoning & activity')

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

// Fills the composer and sends a chat message.
export const sendMessage = async (page: Page, prompt: string): Promise<void> => {
  await page.getByPlaceholder('Ask anything').fill(prompt)
  await page.getByRole('button', { name: 'Send' }).click()
}

// Page-side stream re-pacer. `route.fulfill` is atomic (the browser receives the
// whole SSE body at once), so the frontend never lingers in a mid-stream state long
// enough to observe. Installed BEFORE goto, this wraps window.fetch IN THE PAGE: it
// takes the real edge SSE response and, when it carries the `: tt-gate` marker (which
// `sseStream` emits wherever an answer holds GATE_SENTINEL), replays it as a
// controllable stream — flush part 1, wait for window.__ttGate.release(), then flush
// the rest. It mocks nothing in the app or edge (the bytes come from the real
// worker); it only paces byte delivery, exactly as a slow network would. Other
// (non-marked) SSE responses — e.g. the ReAct decision — are replayed unchanged.
export const installStreamGate = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    let releaseGate = (): void => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    ;(window as unknown as { __ttGate: { release: () => void } }).__ttGate = {
      release: () => releaseGate()
    }

    const GATE_MARKER = '\n: tt-gate\n\n'
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await originalFetch(input, init)
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        return response
      }

      const text = await response.text()
      const markerIndex = text.indexOf(GATE_MARKER)
      if (markerIndex === -1) {
        // No gate in this stream (e.g. the ReAct decision) — replay it as-is.
        return new Response(text, { status: response.status, headers: response.headers })
      }

      const head = `${text.slice(0, markerIndex)}\n`
      const tail = text.slice(markerIndex + GATE_MARKER.length)
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(head))
          await gate
          controller.enqueue(encoder.encode(tail))
          controller.close()
        }
      })
      return new Response(stream, { status: response.status, headers: response.headers })
    }
  })
}

// Releases the held part of a gated stream (see installStreamGate).
export const releaseStreamGate = (page: Page): Promise<void> =>
  page.evaluate(() => {
    ;(window as unknown as { __ttGate: { release: () => void } }).__ttGate.release()
  })
