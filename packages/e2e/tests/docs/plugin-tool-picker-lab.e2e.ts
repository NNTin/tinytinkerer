import { test, expect } from '@playwright/test'
import { dismissFirstLoad } from '../../fixtures/first-load'
import { installChatMock } from '../../fixtures/mock-litellm'
import { PLUGIN_TOOL_PICKER_LAB_URL, seedDocsHostToken } from '../../fixtures/docs-lab'

// The plugin & tool-picker impact lab (docs/plugins-and-tools/plugin-tool-picker-lab.mdx,
// apps/docs/src/live-lab/plugin-tool-picker/) drives the REAL production tool-tree
// picker (ToolTreeSlot/useToolTree, unmodified) against this lab's own docs-only
// appToolGroup of three demo tools (demo-tools.ts): lab_roll_dice,
// lab_explain_plugin_concept, lab_always_fails.
test.use({ viewport: { width: 1280, height: 800 } })

test.describe('docs plugin & tool-picker impact lab (#453)', () => {
  test.beforeEach(async ({ page }) => {
    // Signed in throughout: this lab's signed-out behavior is already covered
    // generically by tests/docs/pixel-agents-lab.e2e.ts (same LiveSessionGate).
    await seedDocsHostToken(page)
  })

  test('toggling a real tool updates the enabled-tools summary', async ({ page }) => {
    await page.goto(PLUGIN_TOOL_PICKER_LAB_URL)
    await dismissFirstLoad(page)

    const summary = page.locator('.plugin-tool-picker-lab__picker-summary strong').first()
    await expect(summary).toHaveText('3 of 3')

    // Scoped to the lab's OWN picker. The embedded ChatApp below now renders one
    // too: an app that owns a tool group carries its tool-tree summarizer, so
    // every surface of that app offers the picker rather than silently omitting
    // it (issue #480 review, finding 1). Both drive the same selection.
    await page
      .locator('[role="group"][aria-label="Tool picker"] [data-testid="tool-tree-toggle"]')
      .click()
    const panel = page.locator('[data-testid="tool-tree-panel"]')
    await expect(panel).toBeVisible()

    const rollDiceCheckbox = panel.locator('[data-testid="tool-tree-tool-lab_roll_dice"]')
    await expect(rollDiceCheckbox).toBeChecked()
    await rollDiceCheckbox.click()
    await expect(rollDiceCheckbox).not.toBeChecked()

    await panel.getByRole('button', { name: 'Close tool picker' }).first().click()
    await expect(panel).toBeHidden()

    await expect(summary).toHaveText('2 of 3')
    await expect(
      page.locator('.plugin-tool-picker-lab__tool-list li', { hasText: 'lab_roll_dice' })
    ).toContainText('(disabled)')
  })

  test('the before/after compare flow runs two conversations end to end', async ({ page }) => {
    await installChatMock(page, 'Activation means the plugin is turned on.')
    await page.goto(PLUGIN_TOOL_PICKER_LAB_URL)
    await dismissFirstLoad(page)

    await page.getByRole('button', { name: 'Compare (2 model calls)' }).click()
    const confirmDialog = page.getByRole('alertdialog', { name: 'Confirm comparison' })
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.getByRole('button', { name: 'Yes, compare' }).click()

    await expect(
      page.getByRole('status').filter({ hasText: 'Running the before/after comparison' })
    ).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Comparison ready' })).toBeVisible({
      timeout: 30_000
    })

    await expect(
      page.locator('.pixel-agents-lab__switcher-title', {
        hasText: 'Before: all demo tools enabled'
      })
    ).toBeVisible()
    await expect(
      page.locator('.pixel-agents-lab__switcher-title', {
        hasText: 'After: your current selection'
      })
    ).toBeVisible()
  })
})
