import { expect, type Page, type Route } from '@playwright/test'

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
   * All DECODED message contents seen across requests, joined. The agent folds
   * the sandbox result into a later request's observation as an (unescaped) string
   * — decoding here lets tests assert on the JSON the sandbox produced (e.g.
   * `"timedOut":true`) without fighting the outer body's quote-escaping.
   */
  allText: () => string
  /** Number of ACTION decisions issued (run_javascript invocations requested). */
  actionCount: () => number
}

type ChatMessage = { role: string; content: string }

const sseStream = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` + 'data: [DONE]\n\n'

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
  let actions = 0

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
    allText: () => decoded.join('\n'),
    actionCount: () => actions
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
  const closeSettings = page.getByRole('button', { name: 'Close settings' }).first()
  // The settings modal can already be open on first load; only open it if not.
  if (!(await closeSettings.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(closeSettings).toBeVisible()
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
// into a follow-up request (every SandboxExecutionResult carries `timedOut`), which
// means the tool actually executed in a real browser sandbox.
export const runSnippetViaChat = async (page: Page, mock: LiteLLMMock): Promise<void> => {
  await page.getByPlaceholder('Ask anything').fill('Run the sandbox isolation check.')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect
    .poll(() => mock.allText().includes('"timedOut"'), {
      timeout: 30_000,
      message: 'sandbox result was never folded back into a model request'
    })
    .toBe(true)
}
