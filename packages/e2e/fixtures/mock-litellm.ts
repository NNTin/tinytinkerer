import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page, type Route } from '@playwright/test'
import { SENTINEL_HOST } from './snippets'
// The REAL edge Hono worker, exercised in-process: every /api/* request the app
// makes is piped through `edgeApp.fetch` (see pipeToEdge), so the suite covers the
// edge worker — its routing, validation, CORS, anonymous-tier key provisioning,
// and the chat proxy — not just the frontend. ONLY LiteLLM (the upstream model
// provider) is mocked; auth (the run is anonymous) and rate limiting (disabled)
// are not under test. Importing from fixtures/ keeps it outside the boundary
// checker's src/ + tests/ scan, which is intentional — this is test wiring.
import { app as edgeApp } from '../../../apps/edge/src/index'
import { dismissTelemetryDialog } from './first-load'

// =============================================================================
// Captured-stream replay (see installReplayMock further below and
// .agent/skills/e2e-testing/SKILL.md). A fixture is produced by
// capture-llm-stream.mjs driving a live PR preview/dev deployment: one fixture
// = one conversation, `exchanges` its successful chat completions in order
// (ReAct decide/act turns, then a final synthesis turn per user prompt).
// `request` is the compact, secret-free digest the capture tool recorded at
// capture time (never headers/cookies/keys) — used here ONLY to drift-check
// replay ordering, never to reconstruct a request. `sse` is the verbatim
// response body text the live model produced.
// =============================================================================

export type CapturedExchange = {
  request: {
    /** First 60 chars of the request's system message. */
    systemPrefix: string
    /** Count of `role: 'tool'` messages already folded into the request. */
    toolResultCount: number
    /** Ordered, distinct `media:<uuid>#<n>` refs found in the request's `tool` contents. */
    mediaRefs: string[]
    /** First 200 chars of the last `role: 'user'` message's content. */
    lastUserText: string
  }
  /** The verbatim SSE response body text captured for this exchange. */
  sse: string
}

export type CapturedFixture = {
  meta: {
    tool: string
    capturedAt: string
    baseUrl: string
    shell: string
    scenario: string
    settings: string[]
    prompts: string[]
    rateLimited: number
  }
  exchanges: CapturedExchange[]
}

// Mirrors capture-llm-stream.mjs's scenario JSON schema (see its --help) — one
// key selects the step kind. Kept here (not re-derived per spec) so a test
// importing `loadScenario` replays the EXACT captured prompts/steps rather
// than retyping them (capture and replay must line up — see the workflow doc).
export type ScenarioStep =
  | { prompt: string; await?: boolean }
  | { waitToast: true }
  | { waitText: string }
  | { clickCanvas: 'center' | { x: number; y: number } }
  | { press: string }
  | { sleepMs: number }
  | { settle: true }

export type Scenario = {
  name: string
  shell: string
  settings: string[]
  steps: ScenarioStep[]
}

// `packages/e2e/fixtures/captures`, resolved from this file — the same
// `import.meta.url`-relative pattern discover-plugins.ts uses, so this needs no
// tsconfig/JSON-import wiring and works identically under `tsc` and the
// Playwright test runner.
const CAPTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'captures')

/** Loads a committed capture fixture by name (packages/e2e/fixtures/captures/<name>.json). */
export const loadCapture = (name: string): CapturedFixture =>
  JSON.parse(readFileSync(join(CAPTURES_DIR, `${name}.json`), 'utf8')) as CapturedFixture

/**
 * Loads a capture's scenario definition (captures/scenarios/<name>.json) — the
 * single source of truth for the prompts/steps a spec must reproduce to stay in
 * lockstep with the fixture it replays.
 */
export const loadScenario = (name: string): Scenario =>
  JSON.parse(readFileSync(join(CAPTURES_DIR, 'scenarios', `${name}.json`), 'utf8')) as Scenario

// A syntactically-valid https base URL that passes the edge's base-URL policy but
// is never really contacted: the edge's outbound calls to it are intercepted by a
// global fetch patch (see installLiteLLMUpstream).
const LITELLM_BASE_URL = 'https://litellm.mock'

// The single chat model the mock catalogue advertises. Its id matches the app's
// default selected model so the context-usage gauge can resolve its limits. The
// context window + the prompt-token usage the stream reports are chosen so the
// gauge lands deterministically in the WARNING band (8000/10000 = 80%).
const MOCK_MODEL_ID = 'chatgpt/gpt-6-astra'
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

// The fixed id the MOCK gives its ask_user tool call. Note the runtime assigns its
// OWN id to the executed call when it replays the turn (issue #276), so this is not
// what appears on the folded-back `tool` result — the parser correlates by the tool's
// function name instead (see parseChoiceResultFromBody). Declared ahead of its use.
const ASK_USER_CALL_ID = 'call_ask_user_1'

// The advertised function name of the choice-prompt tool. `ask_user` has no characters
// the wire-name sanitiser changes, so it is also the name on the forwarded tool_calls.
const ASK_USER_TOOL_NAME = 'ask_user'

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
  /**
   * 'replay' mode only: the most recent loud drift-check failure message (see
   * installReplayMock / mockChatCompletionReplay) — naming the exchange index
   * and expected vs actual request shape — or `undefined` if replay has served
   * every request cleanly so far. `undefined` always for every other mode. A
   * spec/debugger reads this to see WHY a run stalled instead of only a
   * generic poll timeout.
   */
  replayError: () => string | undefined
}

// The wire shape of a native OpenAI-style tool call — used by the synthesized
// run_javascript/ask_user calls the 'tool'/'ask' modes issue below. Not
// exported: only mock-litellm.ts itself builds one now that replay (real
// captured tool_calls) has replaced the scripted mode that used to let a spec
// build its own.
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
// message (issue #85): the answered choice prompt produces a `role: 'tool'` turn whose
// `content` is the JSON-encoded `{ kind, … }` result. The runtime assigns the executed
// call its OWN id (not the mock's), so we cannot match the mock's id directly. Instead
// correlate by the ask_user tool's function NAME: find the assistant tool-call turn
// that called ask_user, take the id the runtime gave it, then read the tool result with
// that id. This keys off the ask_user tool specifically, so a future tool whose result
// also has a `kind` field can never be mis-attributed here (mirrors how the sandbox
// parser owns `'timedOut'`).
const parseChoiceResultFromBody = (body: LiteLLMRequestBody): ChoiceResult | undefined => {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const askUserCallIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      if (call.function.name === ASK_USER_TOOL_NAME) askUserCallIds.add(call.id)
    }
  }
  for (const message of messages) {
    if (message.role !== 'tool' || typeof message.tool_call_id !== 'string') continue
    if (!askUserCallIds.has(message.tool_call_id) || typeof message.content !== 'string') continue
    try {
      const parsed: unknown = JSON.parse(message.content)
      if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
        return parsed as ChoiceResult
      }
    } catch {
      /* a tool result that is not JSON (e.g. an "Error: …" message) */
    }
  }
  return undefined
}

// Generalizes parseChoiceResultFromBody to an ARBITRARY tool name (issue: canvas
// preview/thumbnail/pick e2e): correlate by the given wire function name — find
// the assistant tool-call turn(s) that called it, take the id(s) the runtime
// assigned, then read the matching `tool` result turn's content. Unlike
// parseChoiceResultFromBody (which owns the `kind` field as ask_user's
// signature), this has no output-shape assumption to key off, so it must key by
// name instead; a run that calls the same tool more than once would need a
// smarter correlation, but every run this suite drives (scripted or replayed)
// calls a given tool at most once. Returns the parsed JSON, the raw string
// (for a non-JSON "Error: …" result), or `undefined` if that tool has not
// produced a result yet.
const toolResultByNameFromBody = (body: LiteLLMRequestBody, toolName: string): unknown => {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const callIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      if (call.function.name === toolName) callIds.add(call.id)
    }
  }
  for (const message of messages) {
    if (message.role !== 'tool' || typeof message.tool_call_id !== 'string') continue
    if (!callIds.has(message.tool_call_id) || typeof message.content !== 'string') continue
    try {
      return JSON.parse(message.content) as unknown
    } catch {
      return message.content
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
  id: ASK_USER_CALL_ID,
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
//   • 'replay'  — serve a CAPTURED fixture's real exchanges verbatim, in order
//                 (see installReplayMock / mockChatCompletionReplay below).
//                 Unlike the other (synthesized) modes, the model's tool calls
//                 AND its final prose are real inference output, not invented
//                 here — the canvas verb suite replays REAL captured streams
//                 instead of hand-building tool_calls.
type ChatMode = 'tool' | 'ask' | 'custom-tool' | 'no-tool' | 'replay'

// Per-run state, captured as the edge forwards chat requests to the LiteLLM mock.
type UpstreamState = {
  code: string
  mode: ChatMode
  // The synthesized final-answer content the mock streams back (per-test, so a
  // spec can stream e.g. a ```mermaid block instead of the default sentence).
  // Unused in 'replay' mode (the answer comes from the fixture instead). Either
  // a fixed string, or a resolver keyed off the request's latest user message
  // (issue #430: installKeyedChatMock) so DIFFERENT conversations/prompts on
  // the same page get DIFFERENT streamed answers — the seam the multi-
  // conversation e2e suite uses to tell each conversation's stream apart.
  answer: string | ((lastUserText: string) => string)
  // Optional: when set, the ACTION turn narrates this rationale as ordinary
  // content before its tool call (models a model that explains its action). When
  // undefined the action turn is silent — the realistic non-reasoning default.
  actionReasoning?: string
  customToolCall?: ToolCall
  bodies: string[]
  actions: number
  provisionedKeys: Set<string>
  upstreamCalls: UpstreamCall[]
  // 'replay' mode only (see installReplayMock / mockChatCompletionReplay): the
  // fixture being replayed and a per-run cursor into its exchanges — each
  // chat-completion request consumes exactly the next one. Unused (fixture
  // undefined, cursor stays 0) for every other mode.
  fixture?: CapturedFixture
  replayCursor: number
  replayError?: string
}

// The CONTENT-DRIVEN model behaviour, keyed off the request's system prompt so it
// is robust to call ordering (the default agent is ReAct: decide → act → decide →
// synthesize). The edge forwards `messages` verbatim, so the same detection that
// drove the old in-page mock now drives the mocked LiteLLM upstream.
const streamHeaders = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }

// The most recent `role: 'user'` message's content, or '' if none — the seam
// installKeyedChatMock's resolver keys the streamed answer on (issue #430).
const lastUserMessageText = (messages: ChatMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role === 'user' && typeof message.content === 'string') {
      return message.content
    }
  }
  return ''
}

const MEDIA_REF_RE = /media:[0-9a-f-]+#\d+/g

// Ordered, distinct `media:<uuid>#<n>` refs found across a request's folded-
// back `tool` messages — mirrors capture-llm-stream.mjs's own digestRequest, so
// pairing this against a captured exchange's `request.mediaRefs` (built the
// same way, at capture time) lines up position-for-position.
const distinctMediaRefsInBody = (messages: ChatMessage[]): string[] => {
  const seen = new Set<string>()
  const refs: string[] = []
  for (const message of messages) {
    if (message.role !== 'tool' || typeof message.content !== 'string') continue
    for (const match of message.content.matchAll(MEDIA_REF_RE)) {
      if (!seen.has(match[0])) {
        seen.add(match[0])
        refs.push(match[0])
      }
    }
  }
  return refs
}

// Pairs the captured exchange's mediaRefs (position i = the i-th distinct ref
// the model saw at capture time) with THIS run's distinct refs (the runtime
// mints its own step uuids per session, so the captured ones can never match
// directly) — same order, same count. Empty when the exchange carries no media
// (the common case), which makes applyMediaRekey below a no-op.
const buildMediaRefMap = (capturedRefs: string[], messages: ChatMessage[]): Map<string, string> => {
  const currentRefs = distinctMediaRefsInBody(messages)
  const map = new Map<string, string>()
  capturedRefs.forEach((oldRef, index) => {
    const newRef = currentRefs[index]
    if (newRef) map.set(oldRef, newRef)
  })
  return map
}

// The one normalization replay applies to an otherwise byte-verbatim captured
// SSE body: re-key media handles so they match THIS run's step uuids. A ref can
// be split across SSE deltas (the model streams token-by-token), so the swap
// has to happen over the reassembled text, not per-chunk:
//   1. parse every `data: ` event's JSON, concatenating each
//      `choices[0].delta.content` piece (recording its length);
//   2. do the string replacement over the FULL concatenation (old/new refs are
//      both uuid v4 — equal length — so this can never shift an offset);
//   3. re-slice the result at the recorded lengths to get the new per-event
//      pieces;
//   4. splice each CHANGED piece back into its own event's raw text via a
//      targeted string replace, so every other byte of the stream (ids,
//      whitespace, non-content deltas, usage chunks) survives untouched — no
//      JSON.stringify of a whole event, which could reformat bytes the
//      capture never had.
// A no-op (returns `sse` unchanged) when the map is empty.
const applyMediaRekey = (sse: string, refMap: Map<string, string>): string => {
  if (refMap.size === 0) return sse

  const events = sse.split('\n\n')
  const contentEventIndexes: number[] = []
  const pieces: string[] = []
  events.forEach((event, index) => {
    if (!event.startsWith('data: ') || event === 'data: [DONE]') return
    let parsed: { choices?: Array<{ delta?: { content?: unknown } }> }
    try {
      parsed = JSON.parse(event.slice('data: '.length)) as typeof parsed
    } catch {
      return
    }
    const content = parsed.choices?.[0]?.delta?.content
    if (typeof content === 'string') {
      contentEventIndexes.push(index)
      pieces.push(content)
    }
  })
  if (pieces.length === 0) return sse

  let concatenated = pieces.join('')
  for (const [oldRef, newRef] of refMap) {
    concatenated = concatenated.split(oldRef).join(newRef)
  }

  let offset = 0
  const rekeyedEvents = [...events]
  contentEventIndexes.forEach((eventIndex, pieceIndex) => {
    const oldPiece = pieces[pieceIndex]!
    const newPiece = concatenated.slice(offset, offset + oldPiece.length)
    offset += oldPiece.length
    if (newPiece !== oldPiece) {
      // JSON.stringify escapes a media ref exactly as the capture would have
      // (its uuid/hyphen/digit characters need no escaping either side), so
      // this locates and replaces ONLY the content field's quoted value
      // within the otherwise-untouched raw event.
      rekeyedEvents[eventIndex] = rekeyedEvents[eventIndex]!.replace(
        JSON.stringify(oldPiece),
        JSON.stringify(newPiece)
      )
    }
  })
  return rekeyedEvents.join('\n\n')
}

// Loud, debuggable replay failure: a 500 whose JSON body names the exchange
// index and the expected-vs-actual mismatch. Also stashed on `state` so a
// spec/debugger can read it back via the mock's `replayError()` accessor
// instead of only seeing a generic downstream poll timeout.
const replayFailure = (state: UpstreamState, message: string): Response => {
  state.replayError = message
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { 'content-type': 'application/json' }
  })
}

// 'replay' mode: serve the fixture's exchanges in order, one per chat-completion
// request, byte-verbatim except the media-ref rekey (see applyMediaRekey). A
// per-run cursor (state.replayCursor) tracks which exchange is next. Before
// serving, drift-check the request against what the capture recorded for that
// position: its system message must start with the exchange's `systemPrefix`
// AND its folded-back `tool`-message count must equal `toolResultCount`. A
// mismatch — or running out of exchanges — means the runtime is making
// different requests than the capture (the pipeline or the scenario changed);
// fail loudly rather than silently serving the wrong exchange.
const mockChatCompletionReplay = (body: LiteLLMRequestBody, state: UpstreamState): Response => {
  const fixture = state.fixture
  if (!fixture) return replayFailure(state, 'replay mode installed with no fixture')

  const exchange = fixture.exchanges[state.replayCursor]
  if (!exchange) {
    return replayFailure(
      state,
      `replay: request #${state.replayCursor} has no captured exchange — the fixture only has ${fixture.exchanges.length}`
    )
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  const system = messages.find((m) => m.role === 'system')?.content ?? ''
  const toolResultCount = messages.filter((m) => m.role === 'tool').length
  const { systemPrefix, toolResultCount: expectedToolResultCount } = exchange.request
  if (!system.startsWith(systemPrefix) || toolResultCount !== expectedToolResultCount) {
    return replayFailure(
      state,
      `replay drift at exchange #${state.replayCursor}: expected systemPrefix ` +
        `${JSON.stringify(systemPrefix)} and toolResultCount ${expectedToolResultCount}, got ` +
        `systemPrefix ${JSON.stringify(system.slice(0, 60))} and toolResultCount ${toolResultCount}`
    )
  }

  state.replayCursor += 1
  const refMap = buildMediaRefMap(exchange.request.mediaRefs, messages)
  return new Response(applyMediaRekey(exchange.sse, refMap), {
    status: 200,
    headers: streamHeaders
  })
}

const mockChatCompletion = (body: LiteLLMRequestBody, state: UpstreamState): Response => {
  state.bodies.push(JSON.stringify(body))
  if (state.mode === 'replay') return mockChatCompletionReplay(body, state)
  const messages = Array.isArray(body.messages) ? body.messages : []
  const system = messages.find((m) => m.role === 'system')?.content ?? ''

  if (system.startsWith('You are a ReAct agent')) {
    // Native tool calling (issue #276): the model now emits a real tool_call to
    // act, and answers with content to finish. In 'no-tool' mode there is no tool
    // to drive, so finish on the first decision. Every other mode finishes as
    // soon as ANY `tool` result turn is present (covers both a completed run and
    // a blocked/failed tool, each of which the runtime replays as a
    // `role: 'tool'` message).
    const toolResultCount = messages.filter((m) => m.role === 'tool').length
    const shouldFinish = state.mode === 'no-tool' || toolResultCount > 0
    if (shouldFinish) {
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

    // Act: issue the single run_javascript/ask_user call for that mode. By
    // default with NO content preamble — how a non-reasoning model actually
    // behaves on a tool turn (only the tool call, no prose), so the timeline
    // renders just the decision badge. When the spec opted into narration, the
    // rationale is emitted as ordinary content first and shows as the step's
    // thought (issue #276).
    state.actions += 1
    const toolCall =
      state.mode === 'ask'
        ? askUserToolCall()
        : state.mode === 'custom-tool' && state.customToolCall
          ? state.customToolCall
          : runJavascriptToolCall(state.code)
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
  // switch. Synthesis (any other system prompt): stream the fixed (or resolved,
  // see installKeyedChatMock) final answer.
  const content = system.startsWith('You are a planning assistant')
    ? PLAN
    : typeof state.answer === 'function'
      ? state.answer(lastUserMessageText(messages))
      : state.answer

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

// Shared edge-route wiring, used by every install* helper below (replay
// included): fulfils the exfiltration sentinel host with 200 and records any
// hit (a real egress oracle — see sandbox-isolation.e2e.ts), and pipes every
// /api/** + /health request through the real edge worker.
const installEdgeRoutes = async (page: Page): Promise<{ sentinelHits: string[] }> => {
  const sentinelHits: string[] = []
  await page.route(`**${SENTINEL_HOST}**`, (route) => {
    sentinelHits.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'LEAK' })
  })
  await page.route('**/api/**', (route) => pipeToEdge(route))
  await page.route('**/health', (route) => pipeToEdge(route))
  return { sentinelHits }
}

// Builds the LiteLLMMock accessor object every install* helper returns, closing
// over the same per-run `state` the mocked upstream mutates as requests land.
const buildMockHandle = (state: UpstreamState, sentinelHits: string[]): LiteLLMMock => ({
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
  sentinelHits: () => sentinelHits,
  replayError: () => state.replayError
})

const installMock = async (
  page: Page,
  code: string,
  mode: ChatMode,
  answer: string | ((lastUserText: string) => string),
  actionReasoning?: string,
  customToolCall?: ToolCall
): Promise<LiteLLMMock> => {
  installLiteLLMUpstream()
  const state: UpstreamState = {
    code,
    mode,
    answer,
    ...(actionReasoning !== undefined ? { actionReasoning } : {}),
    ...(customToolCall ? { customToolCall } : {}),
    bodies: [],
    actions: 0,
    provisionedKeys: new Set(knownProvisionedKeys),
    upstreamCalls: [],
    replayCursor: 0
  }
  activeUpstream = state
  const { sentinelHits } = await installEdgeRoutes(page)
  return buildMockHandle(state, sentinelHits)
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

// Deterministic native tool call for app-owned tool integration tests. It drives the
// same ReAct/runtime/tool-registry path as provider output without exposing a test-only
// controller hook in the application.
export const installAppToolMock = (
  page: Page,
  toolName: string,
  input: unknown,
  answer: string = SYNTHESIS_ANSWER
): Promise<LiteLLMMock> =>
  installMock(page, '', 'custom-tool', answer, undefined, {
    id: `call_${toolName}_1`,
    type: 'function',
    function: { name: toolName, arguments: JSON.stringify(input) }
  })

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

// Like installChatMock, but the streamed answer is RESOLVED per request from the
// request's latest `role: 'user'` message instead of fixed (issue #430: the
// Pixel Agents multi-agent suite, tests/pixel-agents-multi-agent.e2e.ts). One
// page can run several conversations
// concurrently, each sending its own prompt; the edge forwards `messages`
// verbatim, so keying the response off the latest user message is the natural
// seam that lets a single mocked upstream answer each conversation distinctly
// (e.g. embed a GATE_SENTINEL only in the prompts that must stay open) without
// tracking which conversation a request "belongs" to.
export const installKeyedChatMock = (
  page: Page,
  answerForPrompt: (lastUserText: string) => string
): Promise<LiteLLMMock> => installMock(page, '', 'no-tool', answerForPrompt)

// A REPLAY mock (see .agent/skills/e2e-testing/SKILL.md): serves a captured
// fixture's real exchanges verbatim, in order, one per chat-completion request
// (see mockChatCompletionReplay). Unlike every other install* helper, the
// model's tool calls AND its final prose are real inference output — nothing
// here is invented — so the canvas verb suite replays actual model behaviour
// end to end instead of hand-building tool_calls.
export const installReplayMock = async (
  page: Page,
  fixture: CapturedFixture
): Promise<LiteLLMMock> => {
  installLiteLLMUpstream()
  const state: UpstreamState = {
    code: '',
    mode: 'replay',
    answer: '',
    bodies: [],
    actions: 0,
    provisionedKeys: new Set(knownProvisionedKeys),
    upstreamCalls: [],
    fixture,
    replayCursor: 0
  }
  activeUpstream = state
  const { sentinelHits } = await installEdgeRoutes(page)
  return buildMockHandle(state, sentinelHits)
}

// Generalizes sandboxResult/choiceResult to an ARBITRARY tool name (see
// toolResultByNameFromBody): the parsed JSON (or raw string, for a non-JSON
// "Error: …" result) of the most recent folded-back `tool` result produced by a
// call to `toolName`, or `undefined` if it has not run yet. Scans the mock's
// captured request bodies most-recent-first, mirroring sandboxResult/
// choiceResult so all three share the same "poll until folded back" idiom.
export const toolResultFor = (mock: LiteLLMMock, toolName: string): unknown => {
  const bodies = mock.requestBodies()
  for (let i = bodies.length - 1; i >= 0; i -= 1) {
    const raw = bodies[i]
    if (!raw) continue
    try {
      const result = toolResultByNameFromBody(JSON.parse(raw) as LiteLLMRequestBody, toolName)
      if (result !== undefined) return result
    } catch {
      /* a non-JSON body never carries a tool result */
    }
  }
  return undefined
}

// Concatenates a captured exchange's streamed `content` deltas back into the
// full answer text — the inverse of how a real model (or sseStream) emits it
// token by token. Ignores tool-call deltas, usage/[DONE] events, and any line
// that fails to parse (an SSE comment is never a `data: ` line).
const concatenateSseContent = (sse: string): string => {
  let content = ''
  for (const event of sse.split('\n\n')) {
    if (!event.startsWith('data: ') || event === 'data: [DONE]') continue
    try {
      const parsed = JSON.parse(event.slice('data: '.length)) as {
        choices?: Array<{ delta?: { content?: unknown } }>
      }
      const piece = parsed.choices?.[0]?.delta?.content
      if (typeof piece === 'string') content += piece
    } catch {
      /* not a `data: ` JSON event */
    }
  }
  return content
}

/**
 * A stable, safe-to-assert-on substring of a captured exchange's synthesized
 * answer — lets a spec wait on "the run has visibly finished" without
 * hardcoding model prose. Captured content is byte-verbatim from the live
 * pipeline — correctly-encoded UTF-8 since #401 fixed the capture tool's CDP
 * decode path (typographic characters like `—`/`’` are common in model prose
 * and render in the DOM exactly as captured). This:
 *   - drops markdown image syntax (`![alt](ref)`) — it renders as an `<img>`,
 *     not text, and its ref is re-keyed anyway (see applyMediaRekey);
 *   - unwraps inline-code backticks and leading list markers (`- `) — the
 *     markdown renderer strips both, leaving only their inner text in the DOM;
 *   - keeps only lines free of control characters (a line broken by a stray
 *     control byte would never match the rendered DOM);
 * then returns the LONGEST such line (more text = a more specific match, less
 * likely to also match some unrelated earlier UI text).
 *
 * `exchangeIndex` defaults to the fixture's LAST exchange — the final
 * synthesis turn, whose content is what actually renders in the transcript
 * (the ReAct final DECISION turn earlier in the fixture carries similar but
 * not identical prose — the runtime re-synthesizes for display).
 */
export const finalAnswerFragment = (fixture: CapturedFixture, exchangeIndex?: number): string => {
  const index = exchangeIndex ?? fixture.exchanges.length - 1
  const exchange = fixture.exchanges[index]
  if (!exchange) {
    throw new Error(`finalAnswerFragment: fixture has no exchange at index ${index}`)
  }
  const content = concatenateSseContent(exchange.sse).replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  const candidates = content
    .split('\n')
    .map((line) =>
      line
        .replace(/^[-*]\s+/, '')
        .replace(/`/g, '')
        .trim()
    )
    .filter((line) => line.length >= 20 && !/[\p{Cc}\p{Cf}]/u.test(line))
    .sort((a, b) => b.length - a.length)
  const fragment = candidates[0]
  if (!fragment) {
    throw new Error(
      `finalAnswerFragment: exchange #${index}'s content has no line that is both printable-` +
        `ASCII-only and long enough to anchor on`
    )
  }
  return fragment
}

// Accumulates a captured exchange's streamed tool-call deltas back into
// `{ name, arguments }` pairs (index-keyed — the same cross-delta accumulation
// the real streaming client does), reassembling arguments split across
// multiple deltas.
const parseToolCallsFromSse = (sse: string): Array<{ name: string; arguments: string }> => {
  const calls = new Map<number, { name: string; arguments: string }>()
  for (const event of sse.split('\n\n')) {
    if (!event.startsWith('data: ') || event === 'data: [DONE]') continue
    let parsed: {
      choices?: Array<{
        delta?: {
          tool_calls?: Array<{ index?: number; function?: { name?: string; arguments?: string } }>
        }
      }>
    }
    try {
      parsed = JSON.parse(event.slice('data: '.length)) as typeof parsed
    } catch {
      continue
    }
    for (const call of parsed.choices?.[0]?.delta?.tool_calls ?? []) {
      const index = call.index ?? 0
      const existing = calls.get(index) ?? { name: '', arguments: '' }
      if (call.function?.name) existing.name = call.function.name
      if (call.function?.arguments) existing.arguments += call.function.arguments
      calls.set(index, existing)
    }
  }
  return [...calls.values()]
}

/**
 * The parsed `arguments` of the first captured tool call to `toolName`,
 * scanning the fixture's exchanges in order — lets a spec assert on exactly
 * what the model asked for (e.g. an interactive pick's toast prompt) without
 * hardcoding captured model behaviour. `undefined` if the fixture never calls
 * that tool.
 */
export const capturedToolCallArgs = (
  fixture: CapturedFixture,
  toolName: string
): Record<string, unknown> | undefined => {
  for (const exchange of fixture.exchanges) {
    const call = parseToolCallsFromSse(exchange.sse).find((c) => c.name === toolName)
    if (call) return JSON.parse(call.arguments) as Record<string, unknown>
  }
  return undefined
}

// Opens Settings, enables the plugin whose Settings label is `label` (plugins are
// off by default), and closes the modal. The toggle's <input> is visually hidden
// (sr-only) but its accessible name comes from the wrapping <label> text, so we
// toggle via the label and read state via isChecked() (which works on hidden
// inputs). The label is also a substring of the checkbox's accessible name (the
// label text plus the plugin description share the wrapping <label>), so a single
// string locates both the click target and the checkbox.
// Opens Settings (if not already open), reveals the tab that renders the given plugin
// label, and ensures its toggle is checked. Returns the Settings dialog locator so the
// caller can read further controls (e.g. a per-plugin dropdown) before closing.
const openSettingsAndEnablePlugin = async (
  page: Page,
  label: string,
  // The surface that owns the Settings button, for a page carrying more than one
  // (issue #495). A documentation page mounts a `<LiveLab>` per lab AND the
  // global assistant, so a page-level `getByRole('button', { name: 'Settings' })`
  // is a strict-mode violation waiting for the first spec that opens the
  // assistant before enabling a plugin. It has not fired only because the
  // assistant is minimized on the routes that use this today — which is a
  // property of those specs, not of this fixture. Defaults to the page, so every
  // single-surface caller is unchanged.
  root: Page | Locator = page
): Promise<Locator> => {
  await dismissTelemetryDialog(page)
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' }).first()
  // The settings modal can already be open on first load; only open it if not.
  // Probe the dialog itself (not the "Close settings" label, which the backdrop
  // also carries) so the open/skip decision is unambiguous.
  if (!(await settingsDialog.isVisible().catch(() => false))) {
    await root.getByRole('button', { name: 'Settings' }).first().click()
    await expect(settingsDialog).toBeVisible()
  }

  // The settings surface is tabbed: the control may live under any tab (plugins
  // under "Tools", interface prefs under "Models"), and only the active tab's
  // panel is mounted. Reveal the control by activating whichever tab renders it.
  const labelText = settingsDialog.getByText(label)
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
  const checkbox = settingsDialog.getByRole('checkbox', { name: label })
  if (!(await checkbox.isChecked())) {
    await labelText.click()
  }
  await expect(checkbox).toBeChecked()
  return settingsDialog
}

// Closes the Settings dialog via the X button inside it (the backdrop also carries the
// "Close settings" label but sits behind the dialog content) and waits for the composer.
const closeSettings = async (page: Page, root: Page | Locator = page): Promise<void> => {
  await page
    .getByRole('dialog', { name: 'Settings' })
    .first()
    .getByRole('button', { name: 'Close settings' })
    .click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
  // Scoped for the same reason as the Settings button above: a documentation page
  // can carry several composers.
  await expect(root.getByRole('button', { name: 'Send' }).first()).toBeVisible()
}

export const enablePlugin = async (
  page: Page,
  label: string,
  root: Page | Locator = page
): Promise<void> => {
  await openSettingsAndEnablePlugin(page, label, root)
  await closeSettings(page, root)
}

// The Code execution plugin (run_javascript tool), enabled via its Settings label.
export const enableCodeExecPlugin = (page: Page, root: Page | Locator = page): Promise<void> =>
  enablePlugin(page, 'Code execution (run_javascript tool)', root)

// The Tool tree plugin (compose-area tool picker, issue #400), enabled via its
// Settings label (exactly `manifest.label`).
export const enableToolTreePlugin = (page: Page): Promise<void> =>
  enablePlugin(page, 'Tool picker (tree view)')

// The Browser state plugin (read_dom tool), enabled via its Settings label (exactly
// `manifest.label`).
export const enableBrowserStatePlugin = (page: Page): Promise<void> =>
  enablePlugin(page, 'Browser state (read_dom tool)')

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

// Enable the Choice prompt plugin AND switch its presentation to "composer" (docked
// above the message box) in one Settings session. The presentation dropdown — the
// plugin's declared `settingsDescriptor` field, rendered generically by the host —
// only appears once the plugin is enabled.
export const enableChoicePromptComposer = async (page: Page): Promise<void> => {
  const settingsDialog = await openSettingsAndEnablePlugin(
    page,
    'Choice prompt (ask you a question)'
  )
  await settingsDialog.getByLabel('Question style').selectOption('composer')
  await closeSettings(page)
}

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
