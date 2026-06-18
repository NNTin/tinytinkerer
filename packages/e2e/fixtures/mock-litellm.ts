import { expect, type Page, type Route } from '@playwright/test'
import { SENTINEL_HOST } from './snippets'

// The shape the sandbox returns (a subset of app-core's SandboxExecutionResult).
// `result` is whatever the adversarial snippet returned — a structured object the
// tests assert against (surfaced through `LiteLLMMock.sandboxResult`).
type SandboxResult = {
  ok?: boolean
  result?: unknown
  logs?: unknown
  timedOut?: boolean
  error?: string
}

// In-page mock of the LiteLLM-backed chat endpoint. Intercepting
// `/api/models/chat` (the web app calls it at a RELATIVE url, edgeBaseUrl='')
// makes the whole suite hermetic: no edge, no wrangler, no auth, no network — so
// "anonymous mode" and "rate limiting disabled" are intrinsic, not configured.
//
// The mock is CONTENT-DRIVEN, keyed off the request's system prompt so it is
// robust to call ordering (the default agent is ReAct: decide → act → decide →
// synthesize, no upfront plan, but a planner response is provided defensively):
//   - "You are a ReAct agent…"        → a decision. First time: ACTION calling
//     run_javascript with the adversarial `code`. Once the tool result is folded
//     back into the observations ("Tool results:"), FINAL so the run ends.
//   - "You are a planning assistant…"  → a minimal valid plan (defensive).
//   - anything else (SYSTEM_STYLE_PROMPT) → a short synthesized answer.
//
// Every request body is captured. The agent runtime folds the sandbox result
// (`SandboxExecutionResult`) back into the next request as the ReAct observation,
// so the captured bodies are the test's in-sandbox oracle — no UI scraping.

export type LiteLLMMock = {
  /** Raw POST bodies received on /api/models/chat, in order. */
  requestBodies: () => string[]
  /**
   * The `SandboxExecutionResult` the runtime folded back into a later request's
   * ReAct observation, parsed out of the captured bodies (most recent first), or
   * `undefined` if the tool has not produced a result yet. This is the in-sandbox
   * oracle: tests assert on the parsed object (`.result`, `.timedOut`, …) rather
   * than substring-matching the whole prompt transcript.
   */
  sandboxResult: () => SandboxResult | undefined
  /** Number of ACTION decisions issued (run_javascript invocations requested). */
  actionCount: () => number
  /**
   * URLs of any request that actually reached the network for the exfiltration
   * sentinel host. A route fulfils these with 200, so a request only lands here if
   * the sandbox let it leave (CSP off); under `connect-src 'none'` the request is
   * blocked in the renderer and never reaches the route — making this a real egress
   * oracle, not a tautology (the sentinel host alone never resolves).
   */
  sentinelHits: () => string[]
}

type ChatMessage = { role: string; content: string }

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

const jsonCompletion = (content: string): string =>
  JSON.stringify({
    id: 'mock-completion',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
  })

const PLAN = JSON.stringify({
  complexity: 'low',
  steps: [
    { id: 'understand', summary: 'Understand the request' },
    { id: 'compose', summary: 'Compose the answer' }
  ]
})

const FINAL_DECISION = JSON.stringify({
  kind: 'final',
  reasoning: 'The sandbox returned its result; ready to answer.'
})

const SYNTHESIS_ANSWER = 'Done — the sandbox finished executing the requested snippet.'

export const installLiteLLMMock = async (page: Page, code: string): Promise<LiteLLMMock> => {
  const bodies: string[] = []
  const decoded: string[] = []
  const sentinelHits: string[] = []
  let actions = 0

  // Exfiltration sentinel: fulfil any request to the sentinel host with 200 and
  // record it. The sandbox's CSP (`connect-src 'none'`, `img-src 'none'`, …) blocks
  // such a request in the renderer before it reaches this route, so a hit means the
  // sandbox actually leaked. Fulfilling (rather than letting it hit the
  // non-resolvable `.invalid` host) is what gives the oracle teeth: a leaking
  // sandbox gets a real 200 back and is detected, instead of failing DNS either way.
  await page.route(`**${SENTINEL_HOST}**`, (route) => {
    sentinelHits.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'LEAK' })
  })

  // Auxiliary edge routes the app may touch on boot — keep it offline-clean.
  await page.route('**/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })
  )
  await page.route('**/api/models/list', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [] })
    })
  )

  await page.route('**/api/models/chat', async (route: Route) => {
    const raw = route.request().postData() ?? ''
    bodies.push(raw)

    let parsed: { stream?: boolean; messages?: ChatMessage[] } = {}
    try {
      parsed = JSON.parse(raw) as typeof parsed
    } catch {
      /* leave defaults */
    }
    const messages = Array.isArray(parsed.messages) ? parsed.messages : []
    decoded.push(messages.map((m) => m.content).join('\n'))
    const system = messages.find((m) => m.role === 'system')?.content ?? ''
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const stream = parsed.stream === true

    let content: string
    if (system.startsWith('You are a ReAct agent')) {
      // The runtime folds a completed tool result into the next observation under
      // "Tool results:"; that is the deterministic signal to stop acting.
      if (lastUser.includes('Tool results:')) {
        content = FINAL_DECISION
      } else {
        actions += 1
        content = JSON.stringify({
          kind: 'action',
          reasoning: 'Run the snippet in the sandbox to gather the observation.',
          toolId: 'run_javascript',
          input: { code }
        })
      }
    } else if (system.startsWith('You are a planning assistant')) {
      content = PLAN
    } else {
      content = SYNTHESIS_ANSWER
    }

    if (stream) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: sseStream(content)
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: jsonCompletion(content)
      })
    }
  })

  return {
    requestBodies: () => bodies,
    sandboxResult: () => {
      for (let i = decoded.length - 1; i >= 0; i -= 1) {
        const result = parseSandboxResult(decoded[i] ?? '')
        if (result) return result
      }
      return undefined
    },
    actionCount: () => actions,
    sentinelHits: () => sentinelHits
  }
}

// Opens Settings, enables the Code execution plugin (off by default), and closes
// the modal. The toggle's <input> is visually hidden (sr-only) but its accessible
// name comes from the wrapping <label> text, so we toggle via the label and assert
// the checkbox state.
// A telemetry-consent dialog auto-opens on first load and its overlay intercepts
// clicks. Decline it (keeps the run clean; telemetry no-ops in dev anyway).
const dismissTelemetryDialog = async (page: Page): Promise<void> => {
  // The dialog appears after hydration (a beat after navigation), so wait for it
  // rather than racing the check.
  const decline = page.getByRole('button', { name: 'Continue without' })
  await decline.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  if (await decline.isVisible().catch(() => false)) {
    await decline.click()
    await expect(page.getByRole('dialog', { name: 'Telemetry' })).toBeHidden()
  }
}

export const enableCodeExecPlugin = async (page: Page): Promise<void> => {
  await dismissTelemetryDialog(page)
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' })
  // The settings modal can already be open on first load; only open it if not.
  // Probe the dialog itself (not the "Close settings" label, which the backdrop
  // also carries) so the open/skip decision is unambiguous.
  if (!(await settingsDialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(settingsDialog).toBeVisible()
  }

  // The toggle's <input> is visually hidden (sr-only), so Playwright never treats
  // it as "visible"; drive it through its visible <label> text and read state via
  // isChecked() (which works on hidden inputs).
  const label = page.getByText('Code execution (run_javascript tool)')
  await label.scrollIntoViewIfNeeded()
  const checkbox = page.getByRole('checkbox', { name: /Code execution/ })
  if (!(await checkbox.isChecked())) {
    await label.click()
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

// Sends a prompt and waits until the mocked run has folded the sandbox result back
// into a follow-up request (i.e. the tool actually executed in a real browser
// sandbox). Then asserts exactly one action was issued — a guard that the
// action→final phase detection works, so a mis-detection can't silently burn the
// iteration budget by running the snippet repeatedly.
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
