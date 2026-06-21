import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  installLiteLLMMock,
  enableCodeExecPlugin,
  enableReasoningActivity,
  dismissTelemetryDialog,
  runSnippetViaChat,
  SYNTHESIS_ANSWER
} from '../fixtures/mock-litellm'

// Real-browser verification of the run_javascript activity timeline (GitHub issue
// #277). With the Reasoning & Activity timeline enabled, a run_javascript turn must:
//   • show the call INPUT (the source) as a read-only, pretty-printed CodeMirror
//     block — like the permission modal;
//   • show the actual console LOGS, not just a line count;
//   • carry an explicit non-colour cue (glyph + word) for the ok/timedOut outcome;
//   • NOT repeat the serialized tool result as a separate raw `run_javascript: {…}`
//     timeline line (the de-duplication).
//
// Only LiteLLM is mocked; the run is anonymous through the real edge worker, which
// drives a real sandbox run (one ACTION then a FINAL once the observation is folded
// back). See e2e/README.md.

// A snippet whose console output and return value are both deterministic, so the
// Logs section and the formatted code block are both assertable.
const SNIPPET = "console.log('alpha'); console.log('beta'); return 6"

// The per-turn panel auto-collapses when the run finishes; expand it so the tool
// activity entry is queryable. Idempotent: only clicks when collapsed.
const expandTimeline = async (page: Page): Promise<Locator> => {
  const toggle = page.getByRole('button', { name: 'Toggle reasoning and activity' }).last()
  await toggle.waitFor({ state: 'visible', timeout: 30_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return page.locator('section', { has: page.getByText('Reasoning & activity') }).last()
}

// Expands the "Ran JavaScript" tool entry and asserts its contents: the formatted
// code block, the real log lines, the ok cue, and the absence of the redundant raw
// result line. There is exactly one tool call, so it asserts within the panel.
const assertActivityEntry = async (panel: Locator): Promise<void> => {
  // The outcome carries an explicit non-colour cue (glyph + spelled-out word) in
  // the collapsed summary, regardless of the open/closed state.
  await expect(panel.locator('[data-activity-status="ok"]')).toContainText('OK')

  // Expand the tool entry (a <details> toggled by its summary).
  await panel.getByText('Ran JavaScript').click()

  // The call input is rendered as a read-only, pretty-printed CodeMirror block.
  const code = panel.locator('.cm-editor')
  await expect(code).toBeVisible()
  await expect(code).toContainText('console.log')

  // The actual log lines are shown — not a "2 lines" count.
  await expect(panel).toContainText('alpha')
  await expect(panel).toContainText('beta')
  await expect(panel).not.toContainText('2 lines')

  // The serialized tool result is NOT repeated as its own raw timeline line.
  await expect(panel.getByText(/run_javascript: \{/)).toHaveCount(0)
}

test.describe('run_javascript activity timeline (#277)', () => {
  test('shows the formatted code, real logs, an outcome cue, no redundant line, and survives reload', async ({
    page
  }) => {
    const mock = await installLiteLLMMock(page, SNIPPET)
    await page.goto('/web/')
    await enableCodeExecPlugin(page)
    await enableReasoningActivity(page)

    // Drive a real ReAct run: one action that runs the snippet in the sandbox, then
    // a final decision once the observation is folded back.
    await runSnippetViaChat(page, mock)
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    await assertActivityEntry(await expandTimeline(page))

    // The tool input + result are projected from persisted step events, so the
    // activity entry (including the code block) survives a reload with no new model
    // request — the turns load from IndexedDB.
    await page.reload()
    await dismissTelemetryDialog(page)
    const settings = page.getByRole('dialog', { name: 'Settings' })
    if (await settings.isVisible().catch(() => false)) {
      await settings.getByRole('button', { name: 'Close settings' }).click()
      await expect(settings).toBeHidden()
    }
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    await assertActivityEntry(await expandTimeline(page))
  })
})
