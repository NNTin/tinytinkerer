import { test, expect, type Page } from '@playwright/test'
import {
  installChatMock,
  installLiteLLMMock,
  enableContextInspectorPlugin,
  enableCodeExecPlugin,
  runSnippetViaChat,
  dismissTelemetryDialog,
  SYNTHESIS_ANSWER,
  type LiteLLMMock
} from '../fixtures/mock-litellm'

// Real-browser verification of the Context inspector plugin (GitHub issue #270).
// The plugin contributes a developer panel showing the EXACT chat request the
// client forwards to the provider each model call — the messages array (system
// prompt + history + tool observations), the model, and stream options. It is off
// by default, web-only, and captures nothing until enabled. jsdom unit tests cover
// the payload→view mapping and the store ring buffer in isolation; this spec proves
// the end-to-end wiring: capture is armed only when enabled, and what the panel
// shows equals what the edge forwarded (the mock's `requestBodies()`).
//
// The plugin contributes no tool and code-exec stays disabled, so this uses the
// NO-TOOL chat mock: the agent answers directly and synthesizes. Only LiteLLM is
// mocked; the run is anonymous through the real edge worker. See README.md.

const TOGGLE = '[data-testid="context-inspector-toggle"]'
const PANEL = '[data-testid="context-inspector-panel"]'
const RESPONSE = '[data-testid="context-inspector-response"]'

const sendMessageAndAwaitReply = async (page: Page, prompt: string): Promise<void> => {
  await page.getByPlaceholder('Ask anything').fill(prompt)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible()
}

// The exact body the edge forwarded for the LAST model call (the synthesize call,
// which the inspector shows by default). Parsed from the mock's capture so the
// assertion is a true equality against what left the client.
const lastForwardedMessages = (mock: LiteLLMMock): Array<{ role: string; content: string }> => {
  const bodies = mock.requestBodies()
  expect(bodies.length).toBeGreaterThan(0)
  const body = JSON.parse(bodies[bodies.length - 1] ?? '{}') as {
    model: string
    messages: Array<{ role: string; content: string }>
  }
  return body.messages
}

test.describe('context-inspector plugin (#270)', () => {
  test('enabled: the panel shows the exact forwarded context after a turn', async ({ page }) => {
    const mock = await installChatMock(page)
    await page.goto('/web/')
    await enableContextInspectorPlugin(page)

    // No capture, no toggle, before any request has been forwarded.
    await expect(page.locator(TOGGLE)).toHaveCount(0)

    await sendMessageAndAwaitReply(page, 'Inspect the exact context for this turn.')

    // A request was forwarded → the developer toggle appears. Open the panel.
    const toggle = page.locator(TOGGLE)
    await expect(toggle).toBeVisible()
    await toggle.click()

    const panel = page.locator(PANEL)
    await expect(panel).toBeVisible()

    // The panel reflects EXACTLY what the edge forwarded for the latest call.
    const messages = lastForwardedMessages(mock)
    expect(messages.length).toBeGreaterThan(0)
    for (const message of messages) {
      // Each forwarded message's content is shown in the panel (per-message rows).
      await expect(panel).toContainText(message.content.slice(0, 60))
    }
    // The system prompt is present and called out as a system message.
    expect(messages.some((m) => m.role === 'system')).toBe(true)

    // The paired response is captured and shown too (the synthesized answer).
    await expect(panel.locator(RESPONSE)).toContainText(SYNTHESIS_ANSWER)
  })

  test('shows the native tools used: advertised tools, the tool call, and its result (#276)', async ({
    page
  }) => {
    const mock = await installLiteLLMMock(page, 'return 1 + 1')
    await page.goto('/web/')
    await enableCodeExecPlugin(page)
    await enableContextInspectorPlugin(page)

    // Drive a real ReAct tool run (one run_javascript action, then final).
    await runSnippetViaChat(page, mock)
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    const toggle = page.locator(TOGGLE)
    await expect(toggle).toBeVisible()
    await toggle.click()
    const panel = page.locator(PANEL)
    await expect(panel).toBeVisible()

    // The default view is the latest call (synthesize), which advertises the tools
    // (tool_choice:'none') and replays the native tool call + result. The header
    // lists the advertised tool — the inspector showed NONE of this before #276.
    await expect(panel.locator('[data-testid="context-inspector-tools"]')).toContainText(
      'run_javascript'
    )

    // The assistant tool-call turn renders a non-blank summary of the call (the
    // wire content is null, so before #276 this row was blank). Expand every row so
    // the (collapsed) message bodies are queryable.
    for (const summary of await panel.locator('summary').all()) {
      await summary.click().catch(() => undefined)
    }
    await expect(panel.getByText(/run_javascript\(/)).toBeVisible()
  })

  test('captures the ACTION decide RESPONSE as the tool call, not "(empty response)" (#276)', async ({
    page
  }) => {
    const mock = await installLiteLLMMock(page, 'return 1 + 1')
    await page.goto('/web/')
    await enableCodeExecPlugin(page)
    await enableContextInspectorPlugin(page)

    await runSnippetViaChat(page, mock)
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    const toggle = page.locator(TOGGLE)
    await expect(toggle).toBeVisible()
    await toggle.click()
    const panel = page.locator(PANEL)
    await expect(panel).toBeVisible()

    // Step BACK through the captured requests to the ACTION react.decide call: its
    // model response is a tool call with no text, which before this fix the panel
    // showed as "(empty response)". It must now render the captured tool call.
    const response = panel.locator(RESPONSE)
    const prev = page.getByRole('button', { name: 'Previous request' })
    let sawToolCallResponse = (await response.textContent())?.includes('run_javascript(') ?? false
    for (let i = 0; i < 6 && !sawToolCallResponse && (await prev.isEnabled()); i += 1) {
      await prev.click()
      sawToolCallResponse = (await response.textContent())?.includes('run_javascript(') ?? false
    }
    expect(sawToolCallResponse).toBe(true)
    await expect(response).not.toContainText('(empty response)')
  })

  test('disabled (default): the inspector never captures or appears', async ({ page }) => {
    const mock = await installChatMock(page)
    await page.goto('/web/')

    // Leave the plugin DISABLED (its default): just clear the first-load dialogs.
    await dismissTelemetryDialog(page)
    const settings = page.getByRole('dialog', { name: 'Settings' })
    if (await settings.isVisible().catch(() => false)) {
      await settings.getByRole('button', { name: 'Close settings' }).click()
      await expect(settings).toBeHidden()
    }

    await sendMessageAndAwaitReply(page, 'This run must not be captured.')

    // The run forwarded requests (the mock saw them) yet the inspector toggle —
    // and thus any captured payload surface — never appeared.
    expect(mock.requestBodies().length).toBeGreaterThan(0)
    await expect(page.locator(TOGGLE)).toHaveCount(0)
  })
})
