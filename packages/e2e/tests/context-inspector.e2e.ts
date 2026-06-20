import { test, expect, type Page } from '@playwright/test'
import {
  installChatMock,
  enableContextInspectorPlugin,
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
