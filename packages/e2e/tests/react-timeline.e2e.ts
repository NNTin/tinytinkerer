import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  installLiteLLMMock,
  installNarratedToolMock,
  enableCodeExecPlugin,
  enableReasoningActivity,
  dismissTelemetryDialog,
  runSnippetViaChat,
  REACT_FINAL_REASONING,
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
// then, once the observation is folded back, a FINAL decision. With native tool
// calling (issue #276) the ACTION turn returns ONLY the tool call (no prose, like
// a real non-reasoning model), so that step renders as just the Action badge — the
// tool + args show in the adjacent tool row. The FINAL turn answers with ordinary
// `content`, shown verbatim as the step's thought. A second test covers a model
// that DOES narrate its action. Both behaviours come straight from
// fixtures/mock-litellm.ts. See e2e/README.md.

const FINAL_REASONING = REACT_FINAL_REASONING
const ACTION_NARRATION = 'Running the snippet in the sandbox to gather the observation.'
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

  // The FINAL turn narrates, so its model prose shows as the step's thought.
  await expect(panel.getByText(FINAL_REASONING)).toBeVisible()

  // The ACTION turn is silent (no model prose), so the step renders as just the
  // Action badge — and crucially NO host-derived "Calling …" label is invented
  // (that was the arch-review regret we removed, issue #276).
  await expect(panel.getByText(/Calling run_javascript/)).toHaveCount(0)

  // Tool USAGE is surfaced regardless: the act step names the tool and its
  // completed run renders with an OK status badge.
  await expect(panel.getByText(/Using run_javascript/)).toBeVisible()
  await expect(panel.locator('[data-activity-status="ok"]').first()).toBeVisible()
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

  test('shows the model prose as the action step thought when the model narrates', async ({
    page
  }) => {
    // The prose-narration path (issue #276 arch-review #4): a model that DOES
    // explain its action streams that rationale as content before the tool call.
    // It must show as the action step's thought — proving prose is surfaced when
    // present, not only the silent-badge path the first test covers.
    const mock = await installNarratedToolMock(page, SNIPPET, ACTION_NARRATION)
    await page.goto('/web/')
    await enableCodeExecPlugin(page)
    await enableReasoningActivity(page)

    await runSnippetViaChat(page, mock)
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    const panel = await expandTimeline(page)
    // The narrated rationale shows as the action step's thought (its label).
    await expect(panel.getByText(ACTION_NARRATION)).toBeVisible()
    await expect(panel.locator('[data-decision-kind="action"]')).toHaveText(/Action/)
    // It is the genuine model prose, never a host-derived "Calling …" label.
    await expect(panel.getByText(/Calling run_javascript/)).toHaveCount(0)
  })
})
