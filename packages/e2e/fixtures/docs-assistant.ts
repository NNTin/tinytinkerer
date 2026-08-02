import { expect, type Page } from '@playwright/test'

// Shared wiring for the documentation assistant widget's e2e specs.
//
// The one thing worth centralising is the pre-send disclosure (issue #481): it
// stands between every FIRST send in a fresh browser context and the model, so a
// spec that types and presses Enter without answering it now waits forever on an
// answer that is never coming. Encoding "how do I send the first message" once
// means a spec asserts what it is about instead of re-deriving the gate.

export const assistantLauncher = (page: Page) =>
  page.getByRole('button', { name: /documentation assistant/i })

export const assistantComposer = (page: Page) => page.getByRole('textbox', { name: 'Message' })

export const preSendDisclosure = (page: Page) =>
  page.getByRole('dialog', { name: 'Before you send this' })

/**
 * Acknowledges the pre-send disclosure if it is open, and returns whether it was.
 *
 * Tolerant of an already-acknowledged session on purpose: acknowledgement is
 * persisted in the assistant's own IndexedDB namespace, so it appears exactly
 * once per browser context, and a spec that sends twice must not have to know
 * which send it is on.
 */
export const acknowledgePreSendDisclosure = async (page: Page): Promise<boolean> => {
  const dialog = preSendDisclosure(page)
  // A short budget: this dialog is rendered synchronously from local state the
  // moment a send is refused, so it is either there on the next frame or the
  // reader has already acknowledged it in this context.
  if (!(await dialog.isVisible({ timeout: 2_000 }).catch(() => false))) return false
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog).toBeHidden()
  return true
}

/**
 * Types a prompt into the open assistant and sends it, answering the pre-send
 * disclosure on the way through.
 */
export const sendAssistantPrompt = async (page: Page, prompt: string): Promise<void> => {
  const composer = assistantComposer(page)
  await composer.fill(prompt)
  await composer.press('Enter')
  await acknowledgePreSendDisclosure(page)
}
