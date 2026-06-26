import { test, expect } from '@playwright/test'
import {
  installChoicePromptMock,
  enableChoicePromptPlugin,
  enablePermissionsPlugin,
  sendMessage,
  CHOICE_QUESTION
} from '../fixtures/mock-litellm'

// Real-browser verification of the Choice prompt plugin (GitHub issue #85) — the
// first interactive human-in-the-loop tool. The mocked model issues a single
// `ask_user` tool call; the host renders a blocking poll modal and folds the user's
// answer back into the run as a native `tool` result (issue #276). This spec proves
// the full two-way loop: the modal opens, the run BLOCKS until the user answers (it
// is held to the human-input budget, not the 10s machine tool timeout), an option
// pick folds back, and a dismissal folds back as a normal `dismissed` result the run
// continues from rather than failing. Only LiteLLM is mocked; the run is anonymous
// through the real edge worker. See packages/e2e/README.md.

const MODAL_NAME = 'Assistant question'

test.describe('choice-prompt plugin (#85)', () => {
  test('option pick: the poll blocks the run, then folds the choice back', async ({ page }) => {
    const mock = await installChoicePromptMock(page)
    await page.goto('/web/')
    await enableChoicePromptPlugin(page)

    await sendMessage(page, 'Ask me which colour I prefer.')

    const modal = page.getByRole('dialog', { name: MODAL_NAME })
    await expect(modal).toBeVisible({ timeout: 30_000 })
    await expect(modal).toContainText(CHOICE_QUESTION)

    // While the poll waits for the human, the answer must not have folded back —
    // the human-input tool is genuinely blocking (and not killed by the 10s machine
    // timeout). Hold briefly to catch a regression where the modal shows but the run
    // does not actually block on it.
    await page.waitForTimeout(500)
    await expect(modal).toBeVisible()
    expect(
      mock.choiceResult(),
      'choice should not fold back before the user answers'
    ).toBeUndefined()

    await modal.getByRole('button', { name: 'Blue' }).click()
    await expect(modal).toBeHidden()

    await expect
      .poll(() => mock.choiceResult(), {
        timeout: 30_000,
        message: 'the picked option was never folded back into a model request'
      })
      .toEqual({ kind: 'option', value: 'Blue' })

    // The run completes after the answer re-enters context.
    await expect(page.getByText('Done')).toBeVisible({ timeout: 30_000 })
  })

  test('dismissal: closing the poll folds back a dismissed result and the run continues', async ({
    page
  }) => {
    const mock = await installChoicePromptMock(page)
    await page.goto('/web/')
    await enableChoicePromptPlugin(page)

    await sendMessage(page, 'Ask me which colour I prefer.')

    const modal = page.getByRole('dialog', { name: MODAL_NAME })
    await expect(modal).toBeVisible({ timeout: 30_000 })

    // Escape dismisses — a normal "the user declined" outcome, not a tool failure.
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()

    await expect
      .poll(() => mock.choiceResult(), {
        timeout: 30_000,
        message: 'the dismissal was never folded back into a model request'
      })
      .toEqual({ kind: 'dismissed' })

    await expect(page.getByText('Done')).toBeVisible({ timeout: 30_000 })
  })

  test('self-gating: with Permissions ON, ask_user shows the choice modal but no permission prompt', async ({
    page
  }) => {
    // The choice-prompt tool is human-input, so the permissions gate self-exempts it
    // (issue #85): even with Permissions enabled, ask_user must NOT raise an allow/deny
    // prompt — that would be a prompt-to-show-a-prompt. The choice modal still shows and
    // the answer folds back, proving the tool ran without being gated.
    const mock = await installChoicePromptMock(page)
    await page.goto('/web/')
    await enableChoicePromptPlugin(page)
    await enablePermissionsPlugin(page)

    await sendMessage(page, 'Ask me which colour I prefer.')

    const choiceModal = page.getByRole('dialog', { name: MODAL_NAME })
    await expect(choiceModal).toBeVisible({ timeout: 30_000 })

    // The permission gate self-exempted, so its modal must never have appeared.
    const permissionModal = page.getByRole('alertdialog', { name: 'Tool permission request' })
    await expect(permissionModal).toBeHidden()

    await choiceModal.getByRole('button', { name: 'Blue' }).click()
    await expect(choiceModal).toBeHidden()

    await expect
      .poll(() => mock.choiceResult(), {
        timeout: 30_000,
        message: 'the picked option was never folded back (was the tool blocked by the gate?)'
      })
      .toEqual({ kind: 'option', value: 'Blue' })
    await expect(page.getByText('Done')).toBeVisible({ timeout: 30_000 })
  })
})
