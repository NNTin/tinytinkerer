import { test, expect, type Page } from '@playwright/test'
import {
  installChatMock,
  enableEventLoggerPlugin,
  dismissTelemetryDialog,
  SYNTHESIS_ANSWER
} from '../fixtures/mock-litellm'

// Real-browser verification of the Event Logger plugin (GitHub issue #246). The
// plugin registers a `chat.event` observer that logs `[event-logger] chat.event →
// <type>` to the browser console for EVERY runtime event — but only when enabled
// (it is off by default). jsdom unit tests cover the handler in isolation; this
// spec proves the end-to-end wiring in a real browser: console output appears when
// the plugin is on, and stays silent when it is off.
//
// The plugin contributes no tool and the code-exec tool stays disabled, so this
// uses the NO-TOOL chat mock (installChatMock): the agent answers directly, with
// no `run_javascript` action, emitting user.message + assistant.* events. Only
// LiteLLM is mocked; the run is anonymous through the real edge worker. See
// packages/e2e/README.md.

const LOG_PREFIX = '[event-logger]'

// Attach a console collector BEFORE navigation so no early log is missed. Returns
// the live array the page's console messages accumulate into.
const collectConsole = (page: Page): string[] => {
  const lines: string[] = []
  page.on('console', (msg) => lines.push(msg.text()))
  return lines
}

// Sends a plain chat message and waits for the synthesized reply to render — the
// DOM signal that the run actually completed (so a "no logs" assertion is not
// vacuously true because nothing ran).
const sendMessageAndAwaitReply = async (page: Page): Promise<void> => {
  await page.getByPlaceholder('Ask anything').fill('Say hello so the runtime emits chat events.')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible()
}

test.describe('event-logger plugin console logging (#246)', () => {
  test('positive: enabling the plugin logs chat events to the console', async ({ page }) => {
    const lines = collectConsole(page)
    await installChatMock(page)
    await page.goto('/web/')
    await enableEventLoggerPlugin(page)

    await sendMessageAndAwaitReply(page)

    // The very first event of any run is user.message; assistant.* events
    // (assistant.chunk / assistant.done) follow during synthesis. Poll rather than
    // race: the reply rendering and the final console flush can settle separately.
    await expect
      .poll(() => lines.some((l) => l === `${LOG_PREFIX} chat.event → user.message`), {
        message: 'expected the event logger to log the user.message event'
      })
      .toBe(true)
    await expect
      .poll(() => lines.some((l) => l.startsWith(`${LOG_PREFIX} chat.event → assistant.`)), {
        message: 'expected the event logger to log at least one assistant.* event'
      })
      .toBe(true)
  })

  test('negative: with the plugin disabled (default) nothing is logged', async ({ page }) => {
    const lines = collectConsole(page)
    await installChatMock(page)
    await page.goto('/web/')

    // Leave the plugin DISABLED (its default): just clear the first-load dialogs so
    // the composer is usable, without touching the Settings toggle.
    await dismissTelemetryDialog(page)
    const settings = page.getByRole('dialog', { name: 'Settings' })
    if (await settings.isVisible().catch(() => false)) {
      await settings.getByRole('button', { name: 'Close settings' }).click()
      await expect(settings).toBeHidden()
    }

    await sendMessageAndAwaitReply(page)

    // The run completed (the reply rendered), so this is a real silence: no
    // event-logger line was ever emitted.
    expect(lines.filter((l) => l.startsWith(LOG_PREFIX))).toEqual([])
  })
})
