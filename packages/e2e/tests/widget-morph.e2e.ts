import { test, expect, type Page } from '@playwright/test'
import { installChatMock, dismissTelemetryDialog } from '../fixtures/mock-litellm'

// Real-browser verification of the widget↔sidebar morph shipped in #325: the widget
// shell is the shared ChatApp in its floating layout, and (being morphable) exposes
// a dock button that swaps it into the docked sidebar layout and back. The critical
// property is CONTINUITY — because both layouts sit under one AppBrowserProvider, the
// conversation (and any in-flight run) survive the swap. jsdom unit tests cover the
// toggle mechanics with a mocked store; this closes the real-browser gap.
//
// Runs against the widget shell only (its own origin/port, like the other specs).
// Only LiteLLM is mocked; the answer streams as small SSE deltas from the real edge.

const requireShellPort = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be set. Run through \`pnpm --filter @tinytinkerer/e2e e2e\`.`)
  }
  return value
}

const WIDGET_URL = `http://localhost:${requireShellPort('E2E_PORT_WIDGET')}/widget/`

const ANSWER = 'Morph answer: this conversation outlives the layout swap.'
const PROMPT = 'Morph continuity check.'

// Closes the first-load telemetry + settings dialogs so the composer is usable.
const dismissFirstLoad = async (page: Page): Promise<void> => {
  await dismissTelemetryDialog(page)
  const settings = page.getByRole('dialog', { name: 'Settings' })
  if (await settings.isVisible().catch(() => false)) {
    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).toBeHidden()
  }
}

test.describe('widget↔sidebar morph (#325)', () => {
  test('dock/undock swaps the layout while the conversation persists', async ({ page }) => {
    await installChatMock(page, ANSWER)
    await page.goto(WIDGET_URL)
    await dismissFirstLoad(page)

    // Send a message in the floating widget.
    const composer = page.locator('textarea').first()
    await composer.fill(PROMPT)
    await composer.press('Enter')
    await expect(page.getByText(PROMPT)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 30_000 })

    // The floating layout offers a dock button; docking morphs into the sidebar.
    const dockButton = page.getByRole('button', { name: 'Dock to sidebar' })
    await expect(dockButton).toBeVisible()
    await dockButton.click()

    // Now docked: the undock (float) button is shown, the dock button is gone, and
    // the SAME conversation is still on screen — the session survived the swap.
    await expect(page.getByRole('button', { name: 'Float chat' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dock to sidebar' })).toHaveCount(0)
    await expect(page.getByText(PROMPT)).toBeVisible()
    await expect(page.getByText(ANSWER)).toBeVisible()

    // Undock back to the floating layout — again without losing the conversation.
    await page.getByRole('button', { name: 'Float chat' }).click()
    await expect(page.getByRole('button', { name: 'Dock to sidebar' })).toBeVisible()
    await expect(page.getByText(PROMPT)).toBeVisible()
    await expect(page.getByText(ANSWER)).toBeVisible()
  })
})
