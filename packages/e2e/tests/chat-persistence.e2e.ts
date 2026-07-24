import { test, expect, type Page } from '@playwright/test'
import { installChatMock } from '../fixtures/mock-litellm'
import { requireShellPort, dismissFirstLoad, closeSettingsIfOpen } from '../fixtures/first-load'

// Real-browser verification that conversations persist to IndexedDB (Dexie) and are
// RESTORED on reload, across all three product shells — web (/web/), widget
// (/widget/), and mobile (/mobile/) (GitHub issue #250). jsdom unit tests mock the
// conversation repository, so real IndexedDB persistence across a page reload —
// initializeChatState (packages/app/app-core/src/chat.ts) loading the latest
// conversation's events and the surface re-rendering them as turns — is uncovered.
// This spec closes that gap in a real browser.
//
// HARNESS TOPOLOGY: the three browser endpoints are ONE build served from ONE origin
// (the composed apps/host/dist), at different paths — matching production. IndexedDB is
// origin-scoped, so with the shared default Dexie DB name (storageNamespace
// `tinytinkerer`) the three endpoints SHARE one database: a conversation created under
// /web/ IS visible from /widget/. The final test asserts exactly that shared session.
//
// Only LiteLLM is mocked; the run is anonymous through the real edge worker, and the
// answer streams as small SSE deltas. The agent answers directly (no tool), so this
// uses the no-tool chat mock with a per-test answer. See packages/e2e/README.md.

// One shared origin, three paths (E2E_PORT_WIDGET / E2E_PORT_MOBILE alias E2E_PORT) →
// one shared IndexedDB across the endpoints.
const SHELLS = [
  { name: 'web', url: `http://localhost:${requireShellPort('E2E_PORT')}/web/` },
  { name: 'widget', url: `http://localhost:${requireShellPort('E2E_PORT_WIDGET')}/widget/` },
  { name: 'mobile', url: `http://localhost:${requireShellPort('E2E_PORT_MOBILE')}/mobile/` }
] as const

// A plain-prose answer that is easy to assert by its text after a reload (the DOM
// signal that the assistant turn was restored from storage, not re-fetched).
const ANSWER = 'Stored answer: this conversation was persisted to IndexedDB.'

// Shell-agnostic send: each shell's composer is a single <textarea> wired to
// Enter-to-send (the placeholder text differs per shell, so target the textarea
// itself rather than a placeholder string).
const sendChat = async (page: Page, prompt: string): Promise<void> => {
  const composer = page.locator('textarea').first()
  await composer.fill(prompt)
  await composer.press('Enter')
}

// The transcript's user-turn bubble, scoped by the themed user-bubble background
// token (which only the user bubble uses, so the selector survives palette
// changes) rather than a bare getByText, to stay robust to any other on-page
// text that happens to match the prompt.
const promptBubble = (page: Page, prompt: string) =>
  page.locator('[class*="user-bubble"]', { hasText: prompt })

test.describe('chat history persistence across reload (#250)', () => {
  for (const shell of SHELLS) {
    test(`${shell.name}: a conversation is restored from IndexedDB after reload`, async ({
      page
    }) => {
      const prompt = `Persist check for the ${shell.name} shell.`
      await installChatMock(page, ANSWER)
      await page.goto(shell.url)
      await dismissFirstLoad(page)

      // The header conversation switcher was removed (office-driven-conversation-
      // management follow-up to issue #430): the Pixel Agents office is now the
      // only conversation-management surface in the whole product, so this shell
      // must never render it.
      await expect(page.getByRole('button', { name: 'Switch conversation' })).toHaveCount(0)

      await sendChat(page, prompt)

      // The user bubble and the assistant content render for the live turn.
      await expect(promptBubble(page, prompt)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 30_000 })

      // Reload in the SAME browser context — IndexedDB is preserved. The telemetry
      // choice is already persisted, so only a Settings dialog might reappear.
      await page.reload()
      await closeSettingsIfOpen(page)

      // The SAME conversation re-renders from storage: both the user turn and the
      // assistant answer come back, not an empty chat. This is the persistence proof
      // — no new chat request is made on reload; the turns are loaded from Dexie.
      await expect(promptBubble(page, prompt)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 30_000 })
    })
  }

  test('shared session across endpoints: a /web/ conversation IS visible from /widget/', async ({
    page
  }) => {
    const web = SHELLS.find((s) => s.name === 'web')!
    const widget = SHELLS.find((s) => s.name === 'widget')!
    const prompt = 'Shared-session probe created in the web endpoint.'

    await installChatMock(page, ANSWER)
    await page.goto(web.url)
    await dismissFirstLoad(page)
    await sendChat(page, prompt)
    await expect(promptBubble(page, prompt)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 30_000 })

    // Navigate to the widget — the SAME origin (one build, one composed dist), a
    // different path, in the SAME browser context. IndexedDB is origin-scoped and the
    // endpoints share the `tinytinkerer` DB name, so the conversation created under
    // /web/ MUST be restored here: signing in / a conversation on one endpoint carries
    // to the others. (Distinct-origin topology would instead isolate them.)
    await page.goto(widget.url)
    await dismissFirstLoad(page)
    await expect(promptBubble(page, prompt)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 30_000 })
  })
})
