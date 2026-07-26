import { test, expect, type Page } from '@playwright/test'
import { dismissFirstLoad } from '../../fixtures/first-load'
import { installAppToolMock } from '../../fixtures/mock-litellm'
import { EXECUTION_TRACE_LAB_URL } from '../../fixtures/docs-lab'

// The execution-trace lab (docs/extending/execution-trace.mdx,
// apps/docs/src/live-lab/execution-trace/) shares the exact same framework
// (LiveLab/LiveSessionGate/LabReset/LabContainer/ConversationSwitcher) already
// exercised end to end by tests/docs/pixel-agents-lab.e2e.ts — this file only
// covers what's genuinely unique to this lab: its own bespoke composer
// (ExecutionTracePanel, not the shared ChatApp) and the rendered run trace.
test.use({ viewport: { width: 1280, height: 800 } })

const sendExecutionTracePrompt = async (page: Page, prompt: string): Promise<void> => {
  await page.getByPlaceholder('Ask the agent to do something that needs a tool…').fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

test.describe('docs execution trace lab (#454)', () => {
  test('a real tool-calling run renders a settled, successful trace entry', async ({ page }) => {
    await installAppToolMock(page, 'lab_roll_dice', { sides: 6, count: 1 }, 'Rolled a 4.')
    await page.goto(EXECUTION_TRACE_LAB_URL)
    await dismissFirstLoad(page)

    await page.getByRole('button', { name: 'New conversation', exact: true }).click()
    await sendExecutionTracePrompt(page, 'Roll a die for me.')

    // The "Request preparation" detail (see this panel's own `run.requests`
    // branch) only appears once the Context Inspector plugin is enabled, which
    // requires a Settings entry point this lab's own bespoke composer never
    // renders (unlike the other labs' shared ChatApp chrome) — out of scope
    // for this lab's own e2e coverage; the settled outcome badge below is the
    // meaningful assertion.
    const run = page.locator('.execution-trace-lab__run').first()
    await expect(run).toBeVisible()
    await expect(run.locator('.execution-trace-lab__badge--success')).toContainText('Succeeded', {
      timeout: 30_000
    })
    await expect(page.getByText('Rolled a 4.')).toBeVisible()
  })
})
