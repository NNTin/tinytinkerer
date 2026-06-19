import { test, expect, type Page } from '@playwright/test'
import {
  installLiteLLMMock,
  enableCodeExecPlugin,
  enablePermissionsPlugin,
  runSnippetViaChat,
  type LiteLLMMock
} from '../fixtures/mock-litellm'
import { WORKER_WORKS } from '../fixtures/snippets'

// Real-browser verification of the Permissions plugin (GitHub issue #247). The
// plugin registers a `tool.beforeExecute` gate that shows a confirmation modal
// before every tool runs. This spec proves: Allow lets the tool execute, Deny
// (button and Escape) blocks it, and with the plugin disabled no modal appears
// (the tool runs directly). Only LiteLLM is mocked; the run is anonymous through
// the real edge worker. See packages/e2e/README.md.

const MODAL_NAME = 'Tool permission request'

// Set up the page with LiteLLM mock and both plugins enabled. Unlike the sandbox
// suite's `drive()`, this does NOT call `runSnippetViaChat` — the modal blocks the
// run before the tool can execute, so the sandbox result never arrives while the
// modal is open. The test drives the flow step by step.
const setupWithPermissions = async (page: Page): Promise<LiteLLMMock> => {
  const mock = await installLiteLLMMock(page, WORKER_WORKS)
  await page.goto('/web/')
  await enableCodeExecPlugin(page)
  await enablePermissionsPlugin(page)
  return mock
}

// Sends the prompt that triggers a run_javascript action. The mock's ReAct decision
// issues the action, which triggers the Permissions gate's modal.
const triggerToolCall = async (page: Page): Promise<void> => {
  await page.getByPlaceholder('Ask anything').fill('Run the sandbox isolation check.')
  await page.getByRole('button', { name: 'Send' }).click()
}

test.describe('permissions plugin tool gate (#247)', () => {
  test('allow: clicking Allow lets the tool execute', async ({ page }) => {
    const mock = await setupWithPermissions(page)

    await triggerToolCall(page)

    const modal = page.getByRole('alertdialog', { name: MODAL_NAME })
    await expect(modal).toBeVisible({ timeout: 30_000 })

    // While the prompt is waiting for human approval, the tool must not execute.
    // Hold briefly to catch regressions where the modal appears but the gate does
    // not actually block `run_javascript`.
    await page.waitForTimeout(500)
    await expect(modal).toBeVisible()
    expect(mock.sandboxResult(), 'tool should not run before Allow is clicked').toBeUndefined()

    await modal.getByRole('button', { name: 'Allow' }).click()
    await expect(modal).toBeHidden()

    await expect
      .poll(() => mock.sandboxResult() !== undefined, {
        timeout: 30_000,
        message: 'sandbox result was never folded back after Allow'
      })
      .toBe(true)
  })

  test('deny: clicking Deny blocks the tool', async ({ page }) => {
    const mock = await setupWithPermissions(page)

    await triggerToolCall(page)

    const modal = page.getByRole('alertdialog', { name: MODAL_NAME })
    await expect(modal).toBeVisible({ timeout: 30_000 })

    await modal.getByRole('button', { name: 'Deny' }).click()
    await expect(modal).toBeHidden()

    // The tool was blocked — no sandbox result should appear. Wait for the
    // assistant's synthesized answer (the run completes via the mock's final
    // decision when it sees the "Tool execution blocked:" observation).
    await expect(page.getByText('Done')).toBeVisible({ timeout: 30_000 })
    expect(mock.sandboxResult(), 'tool should not have run after Deny').toBeUndefined()
  })

  test('deny via Escape: pressing Escape blocks the tool', async ({ page }) => {
    const mock = await setupWithPermissions(page)

    await triggerToolCall(page)

    const modal = page.getByRole('alertdialog', { name: MODAL_NAME })
    await expect(modal).toBeVisible({ timeout: 30_000 })

    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()

    await expect(page.getByText('Done')).toBeVisible({ timeout: 30_000 })
    expect(mock.sandboxResult(), 'tool should not have run after Escape').toBeUndefined()
  })

  test('negative: with permissions disabled, no modal appears and the tool runs', async ({
    page
  }) => {
    const mock = await installLiteLLMMock(page, WORKER_WORKS)
    await page.goto('/web/')
    await enableCodeExecPlugin(page)

    const modalSeen: boolean[] = []
    const modal = page.getByRole('alertdialog', { name: MODAL_NAME })

    const observer = setInterval(() => {
      void modal
        .isVisible()
        .then((v) => {
          if (v) modalSeen.push(true)
        })
        .catch(() => {})
    }, 100)

    try {
      await runSnippetViaChat(page, mock)
    } finally {
      clearInterval(observer)
    }

    expect(modalSeen, 'no permission modal should have appeared').toEqual([])
    expect(mock.sandboxResult(), 'tool should have run directly').toBeDefined()
  })
})
