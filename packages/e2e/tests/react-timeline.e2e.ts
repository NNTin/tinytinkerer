import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  installLiteLLMMock,
  enableCodeExecPlugin,
  enableReasoningActivity,
  dismissTelemetryDialog,
  runSnippetViaChat,
  SYNTHESIS_ANSWER
} from '../fixtures/mock-litellm'

// Real-browser verification of the ReAct decision timeline (GitHub issue #273).
// With the Reasoning & Activity timeline enabled, each ReAct step must surface the
// structured decision the runtime already produces — the decision `reasoning` and
// its `kind` (action vs final) — colour-coded AND with a non-colour cue (a
// spelled-out word + glyph), mirroring the context-usage gauge's colour+shape.
//
// Only LiteLLM is mocked; the run is anonymous through the real edge worker. The
// mock drives a real sandbox run: the model issues one `run_javascript` ACTION
// (reasoning: "Run the snippet…") then, once the observation is folded back, a
// FINAL decision (reasoning: "The sandbox returned its result; ready to answer.").
// Both reasonings come straight from fixtures/mock-litellm.ts. See e2e/README.md.

const ACTION_REASONING = 'Run the snippet in the sandbox to gather the observation.'
const FINAL_REASONING = 'The sandbox returned its result; ready to answer.'
const SNIPPET = 'return 1 + 1'

// The per-turn panel auto-collapses when the run finishes; expand it so the
// (still-projected) decision rows are queryable. Idempotent: only clicks when the
// panel is collapsed.
const expandTimeline = async (page: Page): Promise<Locator> => {
  const toggle = page.getByRole('button', { name: 'Toggle reasoning and activity' }).last()
  await toggle.waitFor({ state: 'visible', timeout: 30_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return page.locator('section', { has: page.getByText('Reasoning & activity') }).last()
}

const assertDecisionRows = async (panel: Locator): Promise<void> => {
  const action = panel.locator('[data-decision-kind="action"]')
  const final = panel.locator('[data-decision-kind="final"]')

  // Both kinds are present and labelled by a non-colour cue (the spelled-out word).
  await expect(action).toHaveText(/Action/)
  await expect(final).toHaveText(/Final/)

  // The decision reasoning text is surfaced for each step.
  await expect(panel.getByText(ACTION_REASONING)).toBeVisible()
  await expect(panel.getByText(FINAL_REASONING)).toBeVisible()
}

test.describe('ReAct decision timeline (#273)', () => {
  test('surfaces decision reasoning and the action/final kind, and survives reload', async ({
    page
  }) => {
    const mock = await installLiteLLMMock(page, SNIPPET)
    await page.goto('/web/')
    await enableCodeExecPlugin(page)
    await enableReasoningActivity(page)

    // Drive a real ReAct run: one action, then a final decision once the sandbox
    // observation is folded back into the next request.
    await runSnippetViaChat(page, mock)
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    // Live (post-run) timeline: the action + final decisions render with their
    // reasoning and a colour + non-colour cue per kind.
    await assertDecisionRows(await expandTimeline(page))

    // The decisions are projected from persisted step events, so they survive a
    // reload (no new model request is made — the turns load from IndexedDB).
    await page.reload()
    await dismissTelemetryDialog(page)
    const settings = page.getByRole('dialog', { name: 'Settings' })
    if (await settings.isVisible().catch(() => false)) {
      await settings.getByRole('button', { name: 'Close settings' }).click()
      await expect(settings).toBeHidden()
    }
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    await assertDecisionRows(await expandTimeline(page))
  })
})
