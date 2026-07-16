import { test, expect, type Page } from '@playwright/test'
import {
  installKeyedChatMock,
  installStreamGate,
  releaseStreamGate,
  sendMessage,
  GATE_SENTINEL,
  SYNTHESIS_ANSWER
} from '../fixtures/mock-litellm'
import { dismissFirstLoad, closeSettingsIfOpen } from '../fixtures/first-load'

// Real-browser verification of the conversation switcher (GitHub issue #430):
// per-conversation runs (up to MAX_CONCURRENT_RUNS = 3 in parallel), lazy
// hydration from IndexedDB on switch, active-id persisted in preferences,
// auto-titling from the first prompt, per-conversation reset/abort (issue
// #332, generalized to N conversations), and two-click delete. See
// packages/app/app-browser/src/chat-shell/conversation-switcher.tsx and
// packages/app/app-browser/src/stores/chat-store.ts.
//
// Only LiteLLM is mocked; the run is anonymous through the real edge worker.
// A single page can drive several conversations' streams concurrently, so
// this suite uses installKeyedChatMock (mock-litellm.ts) to resolve the
// streamed answer from the request's LATEST user message instead of a fixed
// per-page answer — the natural seam, since the edge forwards `messages`
// verbatim regardless of which conversation the run belongs to. Held-open
// concurrent streams reuse the existing `: tt-gate` mid-stream gate machinery
// (installStreamGate/releaseStreamGate, also used by mermaid.e2e.ts): only
// the answers that embed GATE_SENTINEL pause mid-stream, so one page-level
// gate can hold ONE conversation's stream open while another conversation's
// (un-gated) stream runs and completes normally alongside it. Web shell only
// (`/web/`) — the switcher itself is shell-agnostic UI, already covered
// per-shell by unit tests; multiplying this real-browser suite across
// web/widget/mobile would not add coverage.
//
// The cap-refusal notice (3 concurrent gated runs + a 4th refused send) is
// deliberately NOT covered here beyond what the parallel-streams test already
// exercises indirectly: holding 3 concurrent gated streams open plus
// operating a 4th conversation's composer is easy to script but adds a lot of
// runtime for a path unit tests (surfaces.test.tsx, floating/docked-chat-
// surface.test.tsx) already assert precisely (the exact notice text, gated
// only on canStartRun()). See packages/e2e/README.md.

// Mirrors deriveConversationTitle (packages/app/app-core/src/chat.ts): trim,
// collapse whitespace, truncate to TITLE_MAX_LENGTH with a trailing ellipsis.
// Computes the EXACT title text the switcher shows for a given prompt (the
// auto-title, issue #430) without hand-counting characters per test prompt —
// a prompt over 48 chars is genuinely truncated, one at or under is not, and
// callers use this wherever they target a switcher row/trigger by title,
// while asserting the RAW prompt text (untruncated) in the transcript bubble.
const TITLE_MAX_LENGTH = 48
const deriveExpectedTitle = (prompt: string): string => {
  const collapsed = prompt.trim().replace(/\s+/g, ' ')
  return collapsed.length > TITLE_MAX_LENGTH
    ? `${collapsed.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`
    : collapsed
}

const switcherTrigger = (page: Page) => page.getByRole('button', { name: 'Switch conversation' })
const switcherListbox = (page: Page) => page.getByRole('listbox', { name: 'Conversations' })

const openSwitcher = async (page: Page): Promise<void> => {
  if (
    await switcherListbox(page)
      .isVisible()
      .catch(() => false)
  ) {
    return
  }
  await switcherTrigger(page).click()
  await expect(switcherListbox(page)).toBeVisible({ timeout: 15_000 })
}

const conversationOption = (page: Page, title: string) =>
  switcherListbox(page).getByRole('option', { name: title, exact: true })

const selectConversationByTitle = async (page: Page, title: string): Promise<void> => {
  await openSwitcher(page)
  await conversationOption(page, title).click()
}

const createNewConversation = async (page: Page): Promise<void> => {
  await openSwitcher(page)
  await switcherListbox(page).getByRole('button', { name: 'New conversation' }).click()
}

const deleteConversationByTitle = async (page: Page, title: string): Promise<void> => {
  await openSwitcher(page)
  const deleteButton = switcherListbox(page).getByRole('button', {
    name: `Delete conversation ${title}`
  })
  // Two-click confirm (no window.confirm): the first click arms the row.
  await deleteButton.click()
  await expect(deleteButton).toHaveAttribute('title', 'Click again to delete')
  await deleteButton.click()
}

// The dot span is the option button's first child, aria-hidden (so it plays
// no part in the accessible name), rendered amber while that conversation is
// running and transparent otherwise.
const runningDot = (page: Page, title: string) =>
  conversationOption(page, title).locator('span').first()

// A starter prompt from the ALWAYS-present base fillers (conversation-empty-
// state.tsx's BASE_STARTER_PROMPTS), shown whenever the active conversation
// has zero turns regardless of which plugins/MCP servers are configured — a
// shell-agnostic, config-agnostic signal that the transcript is genuinely
// empty (a fresh or just-reset conversation), not merely mid-render.
const EMPTY_STATE_MARKER = 'Explain a concept in simple terms.'

// The transcript's user-turn bubble, scoped by the themed user-bubble
// background token (mirrors chat-persistence.e2e.ts) rather than a bare
// getByText: an UNTRUNCATED prompt (<=48 chars) is byte-identical to its
// auto-derived title, so a plain page.getByText(prompt) also matches the
// switcher trigger's/option's title text — a strict-mode ambiguity a scoped
// locator avoids.
const userBubble = (page: Page, text: string) =>
  page.locator('[class*="user-bubble"]', { hasText: text })

const sendAndAwaitAnswer = async (page: Page, prompt: string, answer: string): Promise<void> => {
  await sendMessage(page, prompt)
  await expect(page.getByText(answer)).toBeVisible({ timeout: 30_000 })
}

test.describe('conversation switcher (#430)', () => {
  test('switcher lifecycle: auto-title, create, switch, and persistence across reload', async ({
    page
  }) => {
    // Deliberately over TITLE_MAX_LENGTH (48) so the auto-title is genuinely
    // truncated (with a trailing ellipsis) in the switcher, while the FULL
    // prompt still renders untruncated in the transcript bubble.
    const PROMPT_FIRST =
      'Explain the FIRST conversation topic for the switcher lifecycle and persistence test in detail.'
    const ANSWER_FIRST = 'Answer for the FIRST conversation topic.'
    const PROMPT_SECOND = 'Explain the SECOND lifecycle test topic.'
    const ANSWER_SECOND = 'Answer for the SECOND conversation topic.'
    const TITLE_FIRST = deriveExpectedTitle(PROMPT_FIRST)
    const TITLE_SECOND = deriveExpectedTitle(PROMPT_SECOND)
    expect(TITLE_FIRST).not.toBe(PROMPT_FIRST) // sanity: truncation actually triggers
    expect(TITLE_SECOND).toBe(PROMPT_SECOND) // sanity: short prompt stays untruncated

    await installKeyedChatMock(page, (lastUserText) => {
      if (lastUserText.includes('SECOND lifecycle test topic')) return ANSWER_SECOND
      if (lastUserText.includes('FIRST conversation topic')) return ANSWER_FIRST
      return SYNTHESIS_ANSWER
    })
    await page.goto('/web/')
    await dismissFirstLoad(page)

    // Send into the pre-existing default conversation — it auto-titles from
    // this first prompt (issue #430, DEFAULT_CONVERSATION_TITLE overwrite).
    await sendAndAwaitAnswer(page, PROMPT_FIRST, ANSWER_FIRST)

    // The trigger shows the active conversation's (auto-derived, truncated)
    // title; the transcript still shows the full untruncated prompt.
    await expect(switcherTrigger(page)).toContainText(TITLE_FIRST)
    await expect(userBubble(page, PROMPT_FIRST)).toBeVisible()

    await openSwitcher(page)
    await expect(conversationOption(page, TITLE_FIRST)).toHaveAttribute('aria-selected', 'true')

    // New conversation: fresh empty state, no trace of the first conversation.
    await createNewConversation(page)
    await expect(page.getByText(EMPTY_STATE_MARKER)).toBeVisible()
    await expect(userBubble(page, PROMPT_FIRST)).toHaveCount(0)

    await sendAndAwaitAnswer(page, PROMPT_SECOND, ANSWER_SECOND)
    await expect(switcherTrigger(page)).toContainText(TITLE_SECOND)

    // Switch back to the first conversation — lazy hydration restores its
    // transcript from IndexedDB, and the second conversation's turns unmount.
    await selectConversationByTitle(page, TITLE_FIRST)
    await expect(userBubble(page, PROMPT_FIRST)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(ANSWER_FIRST)).toBeVisible({ timeout: 30_000 })
    await expect(userBubble(page, PROMPT_SECOND)).toHaveCount(0)

    // Reload: both conversations persisted, and the ACTIVE one (the first,
    // per the active-id preference set by the switch above) is restored.
    await page.reload()
    await closeSettingsIfOpen(page)

    await expect(switcherTrigger(page)).toContainText(TITLE_FIRST, { timeout: 30_000 })
    await expect(userBubble(page, PROMPT_FIRST)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(ANSWER_FIRST)).toBeVisible({ timeout: 30_000 })

    await openSwitcher(page)
    await expect(switcherListbox(page).getByRole('option')).toHaveCount(2)
    await expect(conversationOption(page, TITLE_FIRST)).toHaveAttribute('aria-selected', 'true')
    await expect(conversationOption(page, TITLE_SECOND)).toHaveAttribute('aria-selected', 'false')

    // Both transcripts are intact after switching post-reload too.
    await selectConversationByTitle(page, TITLE_SECOND)
    await expect(userBubble(page, PROMPT_SECOND)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(ANSWER_SECOND)).toBeVisible({ timeout: 30_000 })
  })

  test('parallel streams: a background conversation keeps streaming while another is active, with no cross-contamination', async ({
    page
  }) => {
    const PROMPT_ALPHA = 'Describe the Alpha stream test topic in detail please.'
    const ANSWER_ALPHA_PART1 = 'Alpha streaming has begun with early details.'
    const ANSWER_ALPHA_PART2 = 'Alpha streaming concludes with the final details.'
    const ANSWER_ALPHA = `${ANSWER_ALPHA_PART1}${GATE_SENTINEL} ${ANSWER_ALPHA_PART2}`
    const PROMPT_BETA = 'Describe the Beta stream test topic without holding.'
    const ANSWER_BETA = 'Beta streaming completes immediately with no gate involved.'
    const TITLE_ALPHA = deriveExpectedTitle(PROMPT_ALPHA)
    const TITLE_BETA = deriveExpectedTitle(PROMPT_BETA)

    await installKeyedChatMock(page, (lastUserText) => {
      if (lastUserText.includes('Beta stream test topic')) return ANSWER_BETA
      if (lastUserText.includes('Alpha stream test topic')) return ANSWER_ALPHA
      return SYNTHESIS_ANSWER
    })
    await installStreamGate(page)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    // Conversation A (the pre-existing default) starts streaming and holds at
    // the gate mid-answer.
    await sendMessage(page, PROMPT_ALPHA)
    await expect(page.getByText(ANSWER_ALPHA_PART1)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(ANSWER_ALPHA_PART2)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop generating' })).toBeVisible()

    // Hold and re-check: the pause is durable, not a transient render gap.
    await page.waitForTimeout(1500)
    await expect(page.getByText(ANSWER_ALPHA_PART2)).toHaveCount(0)

    // New conversation (B), made active. A keeps streaming in the background
    // — switching away must not abort it (issue #430's whole point).
    await createNewConversation(page)
    await expect(page.getByText(EMPTY_STATE_MARKER)).toBeVisible()
    await expect(page.getByText(ANSWER_ALPHA_PART1)).toHaveCount(0)

    await sendAndAwaitAnswer(page, PROMPT_BETA, ANSWER_BETA)
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()

    // The switcher surfaces A's background run: the trigger badge counts it,
    // and its row shows the running dot while NOT being the active (✓) row.
    await expect(page.getByLabel('1 other conversation running')).toBeVisible()
    await openSwitcher(page)
    await expect(runningDot(page, TITLE_ALPHA)).toHaveClass(/bg-amber-500/)
    await expect(conversationOption(page, TITLE_ALPHA)).toHaveAttribute('aria-selected', 'false')
    await expect(conversationOption(page, TITLE_BETA)).toHaveAttribute('aria-selected', 'true')

    // Switch to A while it is STILL streaming: its in-progress content shows.
    await selectConversationByTitle(page, TITLE_ALPHA)
    await expect(page.getByText(ANSWER_ALPHA_PART1)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Stop generating' })).toBeVisible()
    await expect(page.getByText(ANSWER_ALPHA_PART2)).toHaveCount(0)

    // Release the gate: A's full answer lands, only in A's transcript.
    await releaseStreamGate(page)
    await expect(page.getByText(ANSWER_ALPHA_PART2)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
    await expect(page.getByText(ANSWER_BETA)).toHaveCount(0)

    // B's transcript is untouched by A's stream — no cross-contamination.
    await selectConversationByTitle(page, TITLE_BETA)
    await expect(page.getByText(ANSWER_BETA)).toBeVisible()
    await expect(page.getByText(ANSWER_ALPHA_PART1)).toHaveCount(0)
    await expect(page.getByText(ANSWER_ALPHA_PART2)).toHaveCount(0)
  })

  test('reset isolation (#332, generalized): resetting a streaming conversation clears it and stays clear, without touching another', async ({
    page
  }) => {
    const PROMPT_RESET_A = 'Start the Reset-Isolation Alpha topic and hold streaming please.'
    const ANSWER_RESET_A_PART1 = 'Reset Alpha streaming part one is here.'
    const ANSWER_RESET_A_PART2 = 'Reset Alpha streaming part two should never appear.'
    const ANSWER_RESET_A = `${ANSWER_RESET_A_PART1}${GATE_SENTINEL} ${ANSWER_RESET_A_PART2}`
    const PROMPT_RESET_B = 'Start the Reset-Isolation Beta topic and finish immediately.'
    const ANSWER_RESET_B = 'Reset Beta streaming completed without any gate.'
    const TITLE_RESET_A = deriveExpectedTitle(PROMPT_RESET_A)
    const TITLE_RESET_B = deriveExpectedTitle(PROMPT_RESET_B)

    await installKeyedChatMock(page, (lastUserText) => {
      if (lastUserText.includes('Reset-Isolation Beta topic')) return ANSWER_RESET_B
      if (lastUserText.includes('Reset-Isolation Alpha topic')) return ANSWER_RESET_A
      return SYNTHESIS_ANSWER
    })
    await installStreamGate(page)
    await page.goto('/web/')
    await dismissFirstLoad(page)

    // A (the pre-existing default conversation) streams and holds at the gate.
    await sendMessage(page, PROMPT_RESET_A)
    await expect(page.getByText(ANSWER_RESET_A_PART1)).toBeVisible({ timeout: 30_000 })

    // B is idle-with-history: a separate, already-completed conversation.
    await createNewConversation(page)
    await sendAndAwaitAnswer(page, PROMPT_RESET_B, ANSWER_RESET_B)

    // Switch back to A — still streaming, gated mid-answer.
    await selectConversationByTitle(page, TITLE_RESET_A)
    await expect(page.getByText(ANSWER_RESET_A_PART1)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Stop generating' })).toBeVisible()

    // Reset the ACTIVE (streaming) conversation: abort-before-clear (#332)
    // empties it immediately.
    await page.getByRole('button', { name: 'Reset conversation' }).click()
    await expect(userBubble(page, PROMPT_RESET_A)).toHaveCount(0)
    await expect(page.getByText(ANSWER_RESET_A_PART1)).toHaveCount(0)
    await expect(page.getByText(EMPTY_STATE_MARKER)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()

    // Release the gate the reset already made moot: no orphaned tail ever
    // resurrects the aborted run's remaining content.
    await releaseStreamGate(page)
    await page.waitForTimeout(1500)
    await expect(page.getByText(ANSWER_RESET_A_PART2)).toHaveCount(0)
    await expect(userBubble(page, PROMPT_RESET_A)).toHaveCount(0)
    await expect(page.getByText(EMPTY_STATE_MARKER)).toBeVisible()

    // B was never touched by A's reset.
    await selectConversationByTitle(page, TITLE_RESET_B)
    await expect(userBubble(page, PROMPT_RESET_B)).toBeVisible()
    await expect(page.getByText(ANSWER_RESET_B)).toBeVisible()
  })

  test('delete: two-click confirm removes a background conversation, and reassigns activity when the active one is deleted', async ({
    page
  }) => {
    const PROMPT_ONE = 'Delete-suite conversation one message content.'
    const ANSWER_ONE = 'Answer for delete-suite conversation one.'
    const PROMPT_TWO = 'Delete-suite conversation two message content.'
    const ANSWER_TWO = 'Answer for delete-suite conversation two.'
    const PROMPT_THREE = 'Delete-suite conversation three message content.'
    const ANSWER_THREE = 'Answer for delete-suite conversation three.'
    const TITLE_ONE = deriveExpectedTitle(PROMPT_ONE)
    const TITLE_TWO = deriveExpectedTitle(PROMPT_TWO)
    const TITLE_THREE = deriveExpectedTitle(PROMPT_THREE)

    await installKeyedChatMock(page, (lastUserText) => {
      if (lastUserText.includes('conversation three')) return ANSWER_THREE
      if (lastUserText.includes('conversation two')) return ANSWER_TWO
      if (lastUserText.includes('conversation one')) return ANSWER_ONE
      return SYNTHESIS_ANSWER
    })
    await page.goto('/web/')
    await dismissFirstLoad(page)

    // Conversation one: the pre-existing default.
    await sendAndAwaitAnswer(page, PROMPT_ONE, ANSWER_ONE)
    await createNewConversation(page)
    await sendAndAwaitAnswer(page, PROMPT_TWO, ANSWER_TWO)
    await createNewConversation(page)
    await sendAndAwaitAnswer(page, PROMPT_THREE, ANSWER_THREE)

    await openSwitcher(page)
    await expect(switcherListbox(page).getByRole('option')).toHaveCount(3)

    // Delete a BACKGROUND conversation (one) while three is active: its row
    // disappears and the active conversation is unaffected.
    await deleteConversationByTitle(page, TITLE_ONE)
    await expect(conversationOption(page, TITLE_ONE)).toHaveCount(0)
    await expect(switcherListbox(page).getByRole('option')).toHaveCount(2)
    await expect(switcherTrigger(page)).toContainText(TITLE_THREE)
    await expect(userBubble(page, PROMPT_THREE)).toBeVisible()
    await expect(page.getByText(ANSWER_THREE)).toBeVisible()

    // Delete the ACTIVE conversation (three): a remaining one (two) becomes
    // active and its transcript renders.
    await deleteConversationByTitle(page, TITLE_THREE)
    await expect(userBubble(page, PROMPT_TWO)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(ANSWER_TWO)).toBeVisible({ timeout: 30_000 })
    await expect(switcherTrigger(page)).toContainText(TITLE_TWO)

    // Delete the LAST remaining conversation (two): with none left, a fresh
    // one is created and made active automatically.
    await deleteConversationByTitle(page, TITLE_TWO)
    await expect(page.getByText(EMPTY_STATE_MARKER)).toBeVisible({ timeout: 30_000 })
    await expect(switcherTrigger(page)).toContainText('New conversation')
    await openSwitcher(page)
    await expect(switcherListbox(page).getByRole('option')).toHaveCount(1)
  })
})
