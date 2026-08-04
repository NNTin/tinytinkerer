import { test, expect, type Page } from '@playwright/test'
import {
  dismissFirstLoad,
  dismissTelemetryDialog,
  requireShellPort
} from '../../fixtures/first-load'
import { installLiteLLMMock, enableCodeExecPlugin } from '../../fixtures/mock-litellm'
import { PLUGIN_TOOL_PICKER_LAB_URL } from '../../fixtures/docs-lab'
import { assistantLauncher } from '../../fixtures/docs-assistant'

/**
 * The documentation's plugin catalogue, on the BUILT SITE (issue #495).
 *
 * `assistant-no-dom-access.e2e.ts` is the negative half of this: it proves what
 * the documentation must never offer, and it is the assertion that carried the
 * guarantee while docs had no plugins at all. This is the positive half, and it
 * only became possible when docs stopped having an empty catalogue:
 *
 * 1. each documentation app OFFERS its approved plugins — the thing that was
 *    literally impossible before, when `/docs` Settings read "No plugins
 *    available" while `/widget` listed the product's;
 * 2. the two apps offer DIFFERENT catalogues, which is what "per-`BrowserApp`"
 *    means in practice and cannot be seen from either app alone;
 * 3. one of them can be enabled and EXECUTED end to end.
 *
 * (3) uses `plugin-code-exec` deliberately. It is the only non-HITL tool plugin
 * in the documentation catalogue that runs entirely in the browser — an
 * opaque-origin iframe and a Worker — so this test spends no shared quota, needs
 * no third-party service, and asserts a real sandbox run rather than a mocked
 * one. Only the LiteLLM call is mocked, as everywhere else in this suite.
 */
const DOCS_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}`
const AUTHORED_ROUTE = `${DOCS_ORIGIN}/docs/architecture/`

/** Deterministic: the folded-back result and the log lines are both assertable. */
const SNIPPET = "console.log('docs-sandbox'); return 21 * 2"

/**
 * The Settings surface in either presentation — the assistant's floating panel
 * renders it `inline`, a live lab's docked surface uses `modal`. Same helper as
 * `assistant-no-dom-access.e2e.ts`, for the same reason.
 */
const settingsPanel = (page: Page) => page.locator('[data-presentation][aria-label="Settings"]')

const openAssistantSettings = async (page: Page): Promise<void> => {
  await assistantLauncher(page).click()
  await expect(
    page.locator('.docs-assistant-root').getByRole('textbox', { name: 'Message' })
  ).toBeVisible({ timeout: 30_000 })
  await dismissTelemetryDialog(page)
  await page.locator('.docs-assistant-root').getByRole('button', { name: 'Settings' }).click()
  await expect(settingsPanel(page)).toBeVisible()
}

test.describe('the documentation plugin catalogue (#495)', () => {
  test('the assistant offers exactly its approved plugins', async ({ page }) => {
    await installLiteLLMMock(page, SNIPPET)
    await page.goto(AUTHORED_ROUTE)
    await openAssistantSettings(page)

    const panel = settingsPanel(page)
    // Present — the defect this issue existed to fix. "No plugins available" is
    // what this panel said before.
    await expect(panel).toContainText('Tool picker (tree view)')
    await expect(panel).toContainText('Context usage gauge')
    await expect(panel).not.toContainText('No plugins available')

    // Absent, each for its own recorded reason (docs-runtime/plugin-catalogue.ts):
    // the rendered page is never a documentation source; a general web search
    // contradicts the grounding and citation policy; and the HITL plugins are out
    // of scope for this surface.
    await expect(panel).not.toContainText('Browser state')
    await expect(panel).not.toContainText('Web search')
    await expect(panel).not.toContainText('Choice prompt')
    await expect(panel).not.toContainText('Permissions')
    // Code execution belongs to the LABS, not the assistant — the difference
    // between the two catalogues, asserted from the app that must not have it.
    await expect(panel).not.toContainText('Code execution')
  })

  test('a live lab enables and executes a catalogued plugin end to end', async ({ page }) => {
    const mock = await installLiteLLMMock(page, SNIPPET)
    await page.goto(PLUGIN_TOOL_PICKER_LAB_URL)
    await dismissFirstLoad(page)

    const lab = page.locator('[data-live-lab]').first()
    await expect(lab).toBeVisible({ timeout: 30_000 })

    // The lab app's catalogue differs from the assistant's: it carries code
    // execution. Enabling it is the ordinary reader path — the Settings toggle,
    // in this app's own storage namespace.
    await lab.getByRole('button', { name: 'Settings' }).first().click()
    await expect(settingsPanel(page)).toBeVisible()
    await expect(settingsPanel(page)).toContainText('Code execution (run_javascript tool)')
    // …and still not the permanently-excluded ones, in this app too.
    await expect(settingsPanel(page)).not.toContainText('Browser state')
    await expect(settingsPanel(page)).not.toContainText('Web search')
    await page.keyboard.press('Escape')

    await enableCodeExecPlugin(page)

    // Now execute it. The model issues one run_javascript action; the sandbox
    // really runs it in the browser and the observation folds back into the next
    // model request. Nothing about this path is documentation-specific — it is
    // the product runtime, reached from a documentation page.
    await page.getByPlaceholder('Ask anything').first().fill('Run the sandbox check.')
    await page.getByRole('button', { name: 'Send' }).first().click()

    await expect
      .poll(() => mock.sandboxResult(), {
        timeout: 30_000,
        message: 'the docs live-lab sandbox result was never folded back into a model request'
      })
      .toMatchObject({ result: 42 })
    expect(mock.actionCount(), 'exactly one run_javascript action should be issued').toBe(1)
  })
})
