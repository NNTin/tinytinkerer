import { expect, type Page } from '@playwright/test'

// Shared first-load dialog helpers + shell-port env lookup, used across the chat
// and canvas specs alike. Deliberately dependency-free (only `@playwright/test`):
// fixtures/mock-litellm.ts statically imports the real edge worker, and
// fixtures/canvas.ts is documented as never pulling mock-litellm in, so anything
// shared between them has to sit below both — importing from either here would
// pull the edge worker (or a chat-only mock) into canvas specs that need neither.

export const requireShellPort = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be set. Run through \`pnpm --filter @tinytinkerer/e2e e2e\`.`)
  }
  return value
}

// A telemetry-consent dialog auto-opens on first load and its overlay intercepts
// clicks. Decline it (keeps the run clean; telemetry no-ops in dev anyway).
const telemetryHandledPages = new WeakSet<Page>()

export const dismissTelemetryDialog = async (page: Page, timeout = 15_000): Promise<void> => {
  if (telemetryHandledPages.has(page)) return

  // The dialog appears after hydration (a beat after navigation), so wait for it
  // rather than racing the check.
  const decline = page.getByRole('button', { name: 'Continue without' })
  await decline.waitFor({ state: 'visible', timeout }).catch(() => undefined)
  if (await decline.isVisible().catch(() => false)) {
    await decline.click()
    await expect(page.getByRole('dialog', { name: 'Telemetry' })).toBeHidden()
  }
  telemetryHandledPages.add(page)
}

// Closes a Settings dialog if one is open (the shell auto-opens Settings on first
// load; after a reload only Settings might reappear since the telemetry choice is
// persisted). The click is scoped INSIDE the dialog because the backdrop also
// carries the "Close settings" label.
export const closeSettingsIfOpen = async (page: Page): Promise<void> => {
  const settings = page.getByRole('dialog', { name: 'Settings' })
  if (await settings.isVisible().catch(() => false)) {
    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).toBeHidden()
  }
}

// Clears the first-load dialog sequence (telemetry consent, then an auto-opened
// Settings modal) so the composer is usable, without touching any Settings toggle.
// `timeout` bounds the telemetry wait — generous on first load, short after a
// reload where the persisted choice means it will not reappear (canvas-excalidraw
// passes 4_000 there).
export const dismissFirstLoad = async (page: Page, timeout = 15_000): Promise<void> => {
  await dismissTelemetryDialog(page, timeout)
  await closeSettingsIfOpen(page)
}
