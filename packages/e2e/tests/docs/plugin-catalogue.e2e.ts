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

/**
 * Plugin toggles are addressed by ROLE and accessible name — each is exactly
 * `manifest.label` — never by panel text.
 *
 * A substring match on the panel is not a catalogue assertion: code-exec's own
 * description mentions both "Browser state" and `read_dom` ("If the Browser state
 * plugin is on, it can read the same already-redacted page snapshot that read_dom
 * produces"), so `not.toContainText('Browser state')` fails against a catalogue
 * that correctly excludes it. Asking for the toggle asks the real question — is
 * this plugin offered — and cannot be answered by prose.
 */
const TOOL_TREE = 'Tool picker (tree view)'
const CONTEXT_GAUGE = 'Context usage gauge'
const CODE_EXEC = 'Code execution (run_javascript tool)'
const BROWSER_STATE = 'Browser state (read_dom tool)'
const WEB_SEARCH = 'Web search (Tavily)'
const CHOICE_PROMPT = 'Choice prompt (ask you a question)'
const PERMISSIONS = 'Permissions (ask before tools run)'

/** Deterministic: the folded-back result and the log lines are both assertable. */
const SNIPPET = "console.log('docs-sandbox'); return 21 * 2"

/**
 * The Settings surface in either presentation — the assistant's floating panel
 * renders it `inline`, a live lab's docked surface uses `modal`. Same helper as
 * `assistant-no-dom-access.e2e.ts`, for the same reason.
 */
const settingsPanel = (page: Page) => page.locator('[data-presentation][aria-label="Settings"]')

/**
 * The plugin list lives on the **Tools** tab, and Settings opens on Account.
 *
 * Asserting against the dialog without activating that tab is not merely a miss:
 * only the ACTIVE tab's panel is mounted, so every `not.toContainText(...)` below
 * would have passed while reading the account panel — a negative assertion that
 * cannot fail is worse than no assertion. This is what the first CI run caught.
 */
const openPluginTab = async (page: Page): Promise<void> => {
  await settingsPanel(page).getByRole('tab', { name: 'Tools' }).click()
  // Anchor on something the Tools panel always renders, so the assertions that
  // follow are known to be reading the mounted plugin list.
  await expect(settingsPanel(page).getByRole('tab', { name: 'Tools' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
}

const openAssistantSettings = async (page: Page): Promise<void> => {
  await assistantLauncher(page).click()
  await expect(
    page.locator('.docs-assistant-root').getByRole('textbox', { name: 'Message' })
  ).toBeVisible({ timeout: 30_000 })
  await dismissTelemetryDialog(page)
  await page.locator('.docs-assistant-root').getByRole('button', { name: 'Settings' }).click()
  await expect(settingsPanel(page)).toBeVisible()
  await openPluginTab(page)
}

test.describe('the documentation plugin catalogue (#495)', () => {
  test('the assistant offers exactly its approved plugins', async ({ page }) => {
    await installLiteLLMMock(page, SNIPPET)
    await page.goto(AUTHORED_ROUTE)
    await openAssistantSettings(page)

    const panel = settingsPanel(page)
    // Present — the defect this issue existed to fix. "No plugins available" is
    // what this panel said before.
    await expect(panel.getByRole('checkbox', { name: TOOL_TREE })).toBeVisible()
    await expect(panel.getByRole('checkbox', { name: CONTEXT_GAUGE })).toBeVisible()
    await expect(panel).not.toContainText('No plugins available')

    // Absent, each for its own recorded reason (docs-runtime/plugin-catalogue.ts):
    // the rendered page is never a documentation source; a general web search
    // contradicts the grounding and citation policy; and the HITL plugins are out
    // of scope for this surface. Code execution belongs to the LABS — the
    // difference between the two catalogues, asserted from the app that must not
    // have it.
    for (const label of [BROWSER_STATE, WEB_SEARCH, CHOICE_PROMPT, PERMISSIONS, CODE_EXEC]) {
      await expect(panel.getByRole('checkbox', { name: label })).toHaveCount(0)
    }
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
    await openPluginTab(page)
    const panel = settingsPanel(page)
    await expect(panel.getByRole('checkbox', { name: CODE_EXEC })).toBeVisible()
    // …and still not the permanently-excluded ones, in this app too.
    for (const label of [BROWSER_STATE, WEB_SEARCH]) {
      await expect(panel.getByRole('checkbox', { name: label })).toHaveCount(0)
    }
    await page.keyboard.press('Escape')

    // Scoped to THIS lab (issue #495): a documentation page carries a Settings
    // button and a composer per mounted surface, so the shared fixture is told
    // which one it is driving rather than relying on the assistant happening to
    // be minimized on this route.
    await enableCodeExecPlugin(page, lab)

    // Now execute it. The model issues one run_javascript action; the sandbox
    // really runs it in the browser and the observation folds back into the next
    // model request. Nothing about this path is documentation-specific — it is
    // the product runtime, reached from a documentation page.
    await lab.getByPlaceholder('Ask anything').first().fill('Run the sandbox check.')
    await lab.getByRole('button', { name: 'Send' }).first().click()

    await expect
      .poll(() => mock.sandboxResult(), {
        timeout: 30_000,
        message: 'the docs live-lab sandbox result was never folded back into a model request'
      })
      .toMatchObject({ result: 42 })
    expect(mock.actionCount(), 'exactly one run_javascript action should be issued').toBe(1)
  })
})
