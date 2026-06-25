import { test, expect, type Page } from '@playwright/test'
import { installChatMock, dismissTelemetryDialog } from '../fixtures/mock-litellm'

// Real-browser verification that conversations persist to IndexedDB (Dexie) and are
// RESTORED on reload, across all three product shells — web (/web/), widget
// (/widget/), and mobile (/mobile/) (GitHub issue #250). jsdom unit tests mock the
// conversation repository, so real IndexedDB persistence across a page reload —
// initializeChatState (packages/app/app-core/src/chat.ts) loading the latest
// conversation's events and the surface re-rendering them as turns — is uncovered.
// This spec closes that gap in a real browser.
//
// HARNESS TOPOLOGY: each shell is served by its own `vite preview` on its own port,
// i.e. its own ORIGIN (see playwright.config.ts). IndexedDB is origin-scoped, so even
// though all three shells default to the SAME Dexie DB name (storageNamespace
// `tinytinkerer`), their storage is ISOLATED: a conversation created under /web/ is
// not visible from /widget/. The final test asserts exactly that. (Had the shells
// been served same-origin under different paths, they would SHARE one database.)
//
// Only LiteLLM is mocked; the run is anonymous through the real edge worker, and the
// answer streams as small SSE deltas. The agent answers directly (no tool), so this
// uses the no-tool chat mock with a per-test answer. See packages/e2e/README.md.

const requireShellPort = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be set. Run through \`pnpm --filter @tinytinkerer/e2e e2e\`.`)
  }
  return value
}

// One origin per shell (different ports → different origins → isolated IndexedDB).
const SHELLS = [
  { name: 'web', url: `http://localhost:${requireShellPort('E2E_PORT')}/web/` },
  { name: 'widget', url: `http://localhost:${requireShellPort('E2E_PORT_WIDGET')}/widget/` },
  { name: 'mobile', url: `http://localhost:${requireShellPort('E2E_PORT_MOBILE')}/mobile/` }
] as const

// A plain-prose answer that is easy to assert by its text after a reload (the DOM
// signal that the assistant turn was restored from storage, not re-fetched).
const ANSWER = 'Stored answer: this conversation was persisted to IndexedDB.'

// Closes the first-load dialogs so the composer is usable, without touching any
// Settings toggle (persistence needs no plugin). Shared across all three shells.
const dismissFirstLoad = async (page: Page): Promise<void> => {
  await dismissTelemetryDialog(page)
  const settings = page.getByRole('dialog', { name: 'Settings' })
  if (await settings.isVisible().catch(() => false)) {
    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).toBeHidden()
  }
}

// Closes a Settings dialog if one is open (used after reload, where the telemetry
// choice is already persisted so only Settings might reappear).
const closeSettingsIfOpen = async (page: Page): Promise<void> => {
  const settings = page.getByRole('dialog', { name: 'Settings' })
  if (await settings.isVisible().catch(() => false)) {
    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).toBeHidden()
  }
}

// Shell-agnostic send: each shell's composer is a single <textarea> wired to
// Enter-to-send (the placeholder text differs per shell, so target the textarea
// itself rather than a placeholder string).
const sendChat = async (page: Page, prompt: string): Promise<void> => {
  const composer = page.locator('textarea').first()
  await composer.fill(prompt)
  await composer.press('Enter')
}

test.describe('chat history persistence across reload (#250)', () => {
  for (const shell of SHELLS) {
    test(`${shell.name}: a conversation is restored from IndexedDB after reload`, async ({
      page
    }) => {
      const prompt = `Persist check for the ${shell.name} shell.`
      await installChatMock(page, ANSWER)
      await page.goto(shell.url)
      await dismissFirstLoad(page)

      await sendChat(page, prompt)

      // The user bubble and the assistant content render for the live turn.
      await expect(page.getByText(prompt)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 30_000 })
      // The user bubble carries the themed user-bubble background token
      // (`bg-[var(--user-bubble)]`); match on the token name, which only the
      // user bubble uses, so the selector survives palette changes.
      await expect(page.locator('[class*="user-bubble"]', { hasText: prompt })).toBeVisible()

      // Reload in the SAME browser context — IndexedDB is preserved. The telemetry
      // choice is already persisted, so only a Settings dialog might reappear.
      await page.reload()
      await closeSettingsIfOpen(page)

      // The SAME conversation re-renders from storage: both the user turn and the
      // assistant answer come back, not an empty chat. This is the persistence proof
      // — no new chat request is made on reload; the turns are loaded from Dexie.
      await expect(page.getByText(prompt)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('[class*="user-bubble"]', { hasText: prompt })).toBeVisible()
    })
  }

  test('shared namespace, isolated by origin: a /web/ conversation is not visible from /widget/', async ({
    page
  }) => {
    const web = SHELLS.find((s) => s.name === 'web')!
    const widget = SHELLS.find((s) => s.name === 'widget')!
    const prompt = 'Origin-isolation probe created in the web shell.'

    await installChatMock(page, ANSWER)
    await page.goto(web.url)
    await dismissFirstLoad(page)
    await sendChat(page, prompt)
    await expect(page.getByText(prompt)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 30_000 })

    // Navigate to the widget — a DIFFERENT origin (different port) in the SAME
    // browser context. IndexedDB is origin-scoped, so despite the shared
    // `tinytinkerer` DB name the widget origin has its own, empty database: the web
    // conversation must NOT appear here. (Same-origin/different-path topology would
    // instead SHARE it — documented in playwright.config.ts and the README.)
    await page.goto(widget.url)
    await dismissFirstLoad(page)
    await expect(page.getByText(prompt)).toHaveCount(0)
    await expect(page.getByText(ANSWER)).toHaveCount(0)
  })
})
