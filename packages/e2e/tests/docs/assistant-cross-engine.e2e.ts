import { test, expect, type Page } from '@playwright/test'
import { dismissTelemetryDialog, requireShellPort } from '../../fixtures/first-load'
import { installChatMock, SYNTHESIS_ANSWER } from '../../fixtures/mock-litellm'
import {
  acknowledgePreSendDisclosure,
  assistantComposer,
  assistantLauncher,
  preSendDisclosure
} from '../../fixtures/docs-assistant'

/**
 * The documentation assistant on Gecko and WebKit (issue #482).
 *
 * ## Why this file exists separately
 *
 * Every other `tests/docs/` spec is Chromium-only, and deliberately so: the
 * accessibility sweep, the contrast measurements, the byte budgets and the long
 * regression suite are expensive, and the deployment target is Chromium. But
 * "Chromium-only" had quietly become the whole documentation assistant, on a
 * feature whose overlay contract leans on three things engines disagree about
 * more than most:
 *
 * - `inert`, which is how the widget leaves the pointer, the tab order and the
 *   accessibility tree in one attribute while staying mounted;
 * - `isolation: isolate`, which establishes the single stacking context the
 *   whole z-index contract depends on;
 * - CSS custom properties on `<html>` driving the docked page inset.
 *
 * So this spec is the narrow cross-engine floor, and it is kept SHORT on
 * purpose. `playwright.config.ts` matches it into the firefox and webkit
 * projects beside `sandbox-isolation.e2e.ts`; everything exhaustive stays on
 * Chromium, where it can afford to be exhaustive. Adding a case here costs three
 * runs, so a case belongs here only if an engine could plausibly differ.
 *
 * Two flows, one per thing that could break: can a reader get an answer at all,
 * and does the overlay contract hold.
 */
const DOCS_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}`
const AUTHORED_ROUTE = `${DOCS_ORIGIN}/docs/architecture/`

const assistantRoot = (page: Page) => page.locator('.docs-assistant-root')

/** Opens the assistant and answers the consent dialog it owns on first activation. */
const activateAssistant = async (page: Page): Promise<void> => {
  await page.goto(AUTHORED_ROUTE)
  await assistantLauncher(page).click()
  await expect(assistantComposer(page)).toBeVisible({ timeout: 30_000 })
  await dismissTelemetryDialog(page)
}

test.describe('the documentation assistant, on every supported engine', () => {
  test('a reader can open it, is told what a send does, and gets an answer', async ({ page }) => {
    const mock = await installChatMock(page)
    await activateAssistant(page)

    const composer = assistantComposer(page)
    await composer.fill('What is TinyTinkerer?')
    await composer.press('Enter')

    // The gate, on this engine: the disclosure is up and nothing has been sent.
    await expect(preSendDisclosure(page)).toBeVisible()
    expect(mock.requestBodies()).toHaveLength(0)

    await acknowledgePreSendDisclosure(page)
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })
    expect(mock.requestBodies().length).toBeGreaterThan(0)
    await expect(composer).toHaveValue('')
  })

  test('a host overlay hides it and gives it back, with focus and the tab order intact', async ({
    page
  }) => {
    await installChatMock(page)
    await activateAssistant(page)

    const root = assistantRoot(page)
    await expect(root).toHaveAttribute('data-host-overlay', 'false')

    // The composer holds focus, which is what makes the restoration below an
    // assertion about something rather than a coincidence.
    const composer = assistantComposer(page)
    await composer.click()
    await expect(composer).toBeFocused()

    // Docusaurus' own search dropdown is one of the three overlays that own the
    // viewport. Opening it must take the assistant out of the pointer, the tab
    // order and the accessibility tree — without unmounting it.
    const search = page.locator('.navbar__search [role="combobox"]').first()
    await search.click()
    await search.fill('plugin')

    await expect(root).toHaveAttribute('data-host-overlay', 'true')
    await expect(root).toHaveAttribute('inert', /.*/)
    // `inert` is the part engines implement differently. The consequence a
    // reader would notice is the one asserted: the composer is not reachable.
    await expect(composer).not.toBeFocused()
    await expect(composer).toBeHidden()

    // Still mounted, so nothing about the conversation was thrown away.
    await expect(root.locator('textarea, input[type="text"]')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(root).toHaveAttribute('data-host-overlay', 'false')
    await expect(root).not.toHaveAttribute('inert', /.*/)
    await expect(composer).toBeVisible()

    // …and it is operable again from the keyboard, which is the half a
    // visibility assertion alone would miss.
    await composer.click()
    await composer.fill('still here')
    await expect(composer).toHaveValue('still here')
  })
})
