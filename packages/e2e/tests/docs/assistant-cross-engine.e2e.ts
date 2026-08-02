import { test, expect, type Page } from '@playwright/test'
import { dismissTelemetryDialog, requireShellPort } from '../../fixtures/first-load'
import { installChatMock, SYNTHESIS_ANSWER } from '../../fixtures/mock-litellm'
import { PIXEL_AGENTS_LAB_URL } from '../../fixtures/docs-lab'
import {
  acknowledgePreSendDisclosure,
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

/**
 * The ASSISTANT's composer, scoped to its own root.
 *
 * The shared `assistantComposer` fixture matches by role and name across the
 * whole page, which is unambiguous on an ordinary documentation route and is
 * not on a lab page: a live lab renders the same `ChatApp`, so an unscoped
 * locator resolves to two textboxes and fails Playwright's strict mode.
 */
const composerIn = (page: Page) => assistantRoot(page).getByRole('textbox', { name: 'Message' })

/** Opens the assistant and answers the consent dialog it owns on first activation. */
const activateAssistant = async (page: Page, url = AUTHORED_ROUTE): Promise<void> => {
  await page.goto(url)
  await assistantLauncher(page).click()
  await expect(composerIn(page)).toBeVisible({ timeout: 30_000 })
  await dismissTelemetryDialog(page)
}

test.describe('the documentation assistant, on every supported engine', () => {
  test('a reader can open it, is told what a send does, and gets an answer', async ({ page }) => {
    const mock = await installChatMock(page)
    await activateAssistant(page)

    const composer = composerIn(page)
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
    // Driven by the FULLSCREEN LAB rather than Docusaurus' search dropdown.
    //
    // The first revision pressed `ControlOrMeta+K` and failed on all THREE
    // engines — Chromium included — so it was never an engine difference at all:
    // that chord does not open this build's search, and the assistant was
    // therefore never asked to hide. (`assistant-widget.e2e.ts` uses `Control+K`,
    // which does.) A shortcut belonging to the upstream search plugin is the
    // wrong thing for this suite to depend on either way; it exists for the
    // handful of behaviours an ENGINE could differ on.
    //
    // The fullscreen lab reaches the identical code path (it declares itself
    // through `setDocsHostOverlay`, and the root's `inert`/visibility rules do not
    // care which overlay declared it) behind a plain button click. Detection of
    // the Docusaurus-owned overlays is ordinary DOM querying, engine-independent,
    // and stays covered on Chromium by `assistant-widget.e2e.ts`.
    await installChatMock(page)
    await activateAssistant(page, PIXEL_AGENTS_LAB_URL)

    const root = assistantRoot(page)
    await expect(root).toHaveAttribute('data-host-overlay', 'false')

    // The composer holds focus, which is what makes the restoration below an
    // assertion about something rather than a coincidence.
    const composer = composerIn(page)
    await composer.click()
    await expect(composer).toBeFocused()

    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click()

    await expect(root).toHaveAttribute('data-host-overlay', 'true')
    await expect(root).toHaveAttribute('inert', /.*/)

    // Gone from the ACCESSIBILITY TREE, which is the guarantee `inert` and
    // `visibility: hidden` exist to give and the one an engine could get wrong.
    // A role-based locator only matches what is exposed there, so zero matches
    // is the assertion — not `toBeHidden()`, which a detached element also
    // satisfies, and not `not.toBeFocused()`, which needs the element to resolve
    // and therefore errors here rather than passing.
    await expect(composer).toHaveCount(0)

    // Focus actually LEFT the subtree, rather than staying on an element the
    // reader can no longer see or reach.
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(document.activeElement?.closest('.docs-assistant-root')))
      )
      .toBe(false)

    // Still MOUNTED, though — the conversation, the composer draft and any
    // in-flight run survive, which is the whole reason this hides rather than
    // unmounts. A CSS locator, deliberately: it does not consult the
    // accessibility tree, so it can see what the assertion above cannot.
    await expect(root.locator('.docs-assistant-mount')).toHaveCount(1)

    await page.getByRole('button', { name: 'Exit fullscreen' }).click()
    await expect(root).toHaveAttribute('data-host-overlay', 'false')
    await expect(root).not.toHaveAttribute('inert', /.*/)
    await expect(composer).toBeVisible()

    // …and it is operable again, which is the half a visibility assertion alone
    // would miss: `inert` has to have been removed, not just the styling.
    await composer.click()
    await composer.fill('still here')
    await expect(composer).toHaveValue('still here')
  })
})
