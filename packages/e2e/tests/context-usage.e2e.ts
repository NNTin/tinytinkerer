import { test, expect, type Page } from '@playwright/test'
import {
  installChatMock,
  enableContextUsagePlugin,
  dismissTelemetryDialog,
  MOCK_CONTEXT_PERCENT,
  SYNTHESIS_ANSWER
} from '../fixtures/mock-litellm'

// Real-browser verification of the Context usage gauge plugin (GitHub issue #264).
// The plugin contributes a persistent SVG gauge near the composer showing what
// share of the model's input context window is used. It is off by default and only
// renders once the model reports token usage (the synthesize call requests
// `stream_options.include_usage`) against a known context window (surfaced by the
// edge from LiteLLM `/model/info`). jsdom unit tests cover the gauge math and the
// SSE usage parsing in isolation; this spec proves the end-to-end wiring: the edge
// surfaces the limit, the client opts into usage, the runtime emits `agent.usage`,
// and the host renders the gauge with the right threshold — and hides it otherwise.
//
// The plugin contributes no tool and code-exec stays disabled, so this uses the
// NO-TOOL chat mock: the agent answers directly and synthesizes. Only LiteLLM is
// mocked; the run is anonymous through the real edge worker. The mock catalogue
// advertises the default model with max_input_tokens=10000 and the synthesize
// stream reports prompt_tokens=8000 → 80% → WARNING. See packages/e2e/README.md.

const GAUGE = '[data-testid="context-usage-gauge"]'

const sendMessageAndAwaitReply = async (page: Page): Promise<void> => {
  await page.getByPlaceholder('Ask anything').fill('Say hello so the runtime reports token usage.')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible()
}

test.describe('context-usage gauge plugin (#264)', () => {
  test('enabled: the gauge appears after a turn with the warning threshold', async ({ page }) => {
    await installChatMock(page)
    await page.goto('/web/')
    await enableContextUsagePlugin(page)

    // Hidden before any usage has been observed, even though the plugin is on.
    await expect(page.locator(GAUGE)).toHaveCount(0)

    await sendMessageAndAwaitReply(page)

    // The synthesize call reported usage against the known context window, so the
    // gauge now renders. The percent is no longer shown as visible text (it lives
    // in the tooltip/accessible name); severity is conveyed without colour by the
    // arc + a shape badge. Assert the data-threshold and the accessible name.
    const gauge = page.locator(GAUGE)
    await expect(gauge).toBeVisible()
    await expect(gauge).toHaveAttribute('data-threshold', 'warning')
    await expect(gauge).toHaveAttribute('aria-label', new RegExp(`${MOCK_CONTEXT_PERCENT}%`))
  })

  test('disabled (default): the gauge never appears', async ({ page }) => {
    await installChatMock(page)
    await page.goto('/web/')

    // Leave the plugin DISABLED (its default): just clear the first-load dialogs.
    await dismissTelemetryDialog(page)
    const settings = page.getByRole('dialog', { name: 'Settings' })
    if (await settings.isVisible().catch(() => false)) {
      await settings.getByRole('button', { name: 'Close settings' }).click()
      await expect(settings).toBeHidden()
    }

    await sendMessageAndAwaitReply(page)

    // The run completed (the reply rendered) yet the gauge stayed absent.
    await expect(page.locator(GAUGE)).toHaveCount(0)
  })
})
