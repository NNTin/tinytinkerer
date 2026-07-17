import { expect, test, type Page } from '@playwright/test'
import { closeSettingsIfOpen, dismissFirstLoad } from '../fixtures/first-load'
import {
  GATE_SENTINEL,
  installKeyedChatMock,
  installStreamGate,
  releaseStreamGate,
  sendMessage,
  SYNTHESIS_ANSWER
} from '../fixtures/mock-litellm'
import {
  agentOverlayCloseButton,
  agentOverlayLocator,
  calibrateCharacterSlot,
  characterIds,
  characterSpriteIdsInWindow,
  clickCharacterToSelect,
  dispatchPixelClientMessage,
  enablePixelHooks,
  PIXEL_AGENTS_URL,
  readAnimationDrawLog,
  readMessageLog,
  resetAnimationProbe,
  selectPersistentAgent,
  waitForOfficeFrame
} from '../fixtures/pixel-agents'

// Multi-agent Pixel Agents coverage (issue #430 PR 5): one office character per
// conversation, dynamic agentCreated/agentClosed, and the interactive office
// (launchAgent/focusAgent/closeAgent). See packages/e2e/pixel-agents-testing.md
// for the general layered-evidence approach this suite (and
// tests/pixel-agents.e2e.ts / tests/pixel-agents-activity.e2e.ts) shares; this
// file is specifically about what changes once there is more than one agent.
//
// Real clicks are used everywhere upstream offers a reliably scriptable one:
//   - "New conversation" in the assistant panel's switcher (real DOM button —
//     this is TinyTinkerer's own UI, not the vendored office).
//   - focusAgent: a real click on the character itself (clickCharacterToSelect
//     in fixtures/pixel-agents.ts). Its own doc comment has the full story, but
//     the short version: this is the exact code path upstream's own canvas
//     click handler always was, and clicking a character turns out to ALSO
//     send `focusAgent` unconditionally (not just set the office's local
//     selection) — confirmed empirically, not assumed from reading the
//     (minified, hard to fully trust) vendored bundle alone.
//   - closeAgent (the office's own "select-then-×" flow): the SAME real
//     character click to select, then a REAL Playwright click on the "Close
//     agent" button that appears once selected. The button is user-visible
//     since issue #430 (pixel-agents-bridge.mjs now hides only Settings):
//     select-then-close is the deliberate-interaction guard for deleting the
//     conversation.
//   - launchAgent is the other exception: the vendored bundle only renders its
//     "+ Agent" toolbar button in a VS Code extension host (verified by
//     inspecting the built upstream bundle: gated on `typeof acquireVsCodeApi
//     === 'undefined'`), so no click — real or raw — can ever reach it in this
//     browser-embedded deployment (the JSX branch itself never renders). That
//     interaction is driven via the bridge's client envelope
//     (dispatchPixelClientMessage) instead — see its own doc comment.

test.use({ viewport: { width: 1280, height: 800 } })

const switcherTrigger = (page: Page) => page.getByRole('button', { name: 'Switch conversation' })
const switcherListbox = (page: Page) => page.getByRole('listbox', { name: 'Conversations' })

// `characterIds`'s order is `getCharacters()`'s Map-insertion order, which
// follows the STAGE's bootstrap iteration order over conversations — i.e.
// most-recent-updatedAt-first, an incidental ordering this suite never means
// to assert on (only WHICH agent numbers exist as characters). Sorted so an
// equality check is robust to which conversation happened to be updated more
// recently.
const sortedCharacterIds = (frame: Parameters<typeof characterIds>[0]): Promise<number[]> =>
  characterIds(frame).then((ids) => [...ids].sort((a, b) => a - b))

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

const createNewConversation = async (page: Page): Promise<void> => {
  await openSwitcher(page)
  await switcherListbox(page).getByRole('button', { name: 'New conversation' }).click()
}

const selectConversationByTitle = async (page: Page, title: string): Promise<void> => {
  await openSwitcher(page)
  await conversationOption(page, title).click()
}

// The switcher listbox is an absolutely positioned panel INSIDE the assistant
// panel (not a full-page portal) that only closes on a pointerdown the host
// document itself observes — a click inside the sandboxed office iframe is a
// separate document and never bubbles up to that listener. Left open, its
// panel can sit above the office iframe in stacking order and swallow clicks
// meant for it. Close it explicitly (Escape, which its own useDialogEscape
// handles) before any office-iframe interaction that follows an
// openSwitcher/assertion block.
const closeSwitcherIfOpen = async (page: Page): Promise<void> => {
  if (
    await switcherListbox(page)
      .isVisible()
      .catch(() => false)
  ) {
    await page.keyboard.press('Escape')
    await expect(switcherListbox(page)).toBeHidden()
  }
}

// Mirrors chat-persistence.e2e.ts / multi-conversation.e2e.ts: scoped by the
// themed user-bubble background token rather than a bare getByText, since an
// untruncated prompt is byte-identical to its auto-derived switcher title.
const userBubble = (page: Page, text: string) =>
  page.locator('[class*="user-bubble"]', { hasText: text })

const sendAndAwaitAnswer = async (page: Page, prompt: string, answer: string): Promise<void> => {
  await sendMessage(page, prompt)
  await expect(page.getByText(answer)).toBeVisible({ timeout: 30_000 })
}

// "The answer is visible" is a live-store signal, not a persistence one (see
// pixel-agents-testing.md's "history vs. live" section and pixel-agents-
// activity.e2e.ts's persistedRunComplete, which this mirrors): both the
// conversation ROW (db.ts's `conversations` table) and its chat events land in
// the shared 'tinytinkerer' IndexedDB asynchronously, so a reload right after
// the answer renders can race either write — exactly the two conversations a
// reload-persistence test needs intact. Polls the SAME shared database a
// restore reads: `conversationCount` conversation rows exist AND the fragment
// appears in some persisted event, before any reload.
const chatDatabasePersisted = (
  page: Page,
  fragment: string,
  conversationCount: number
): Promise<boolean> =>
  page.evaluate(
    ({ needle, count }) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('tinytinkerer')
        open.onerror = () => reject(open.error ?? new Error('Could not open the chat database'))
        open.onsuccess = () => {
          const database = open.result
          if (
            !database.objectStoreNames.contains('events') ||
            !database.objectStoreNames.contains('conversations')
          ) {
            database.close()
            resolve(false)
            return
          }
          const tx = database.transaction(['events', 'conversations'])
          const eventsRequest = tx.objectStore('events').getAll()
          const conversationsRequest = tx.objectStore('conversations').getAll()
          tx.onerror = () => reject(tx.error ?? new Error('Could not read the chat database'))
          tx.oncomplete = () => {
            resolve(
              conversationsRequest.result.length >= count &&
                JSON.stringify(eventsRequest.result).includes(needle)
            )
            database.close()
          }
        }
      }),
    { needle: fragment, count: conversationCount }
  )

test.describe('Pixel Agents multi-agent office (#430)', () => {
  test('two conversations project two office characters; only the running one animates', async ({
    page
  }) => {
    const PROMPT_ALPHA = 'Run the Alpha activity animation test topic please.'
    const ANSWER_ALPHA_PART1 = 'Alpha animation streaming has begun.'
    const ANSWER_ALPHA_PART2 = 'Alpha animation streaming concludes.'
    const ANSWER_ALPHA = `${ANSWER_ALPHA_PART1}${GATE_SENTINEL} ${ANSWER_ALPHA_PART2}`

    await enablePixelHooks(page)
    await installKeyedChatMock(page, (lastUserText) =>
      lastUserText.includes('Alpha activity animation') ? ANSWER_ALPHA : SYNTHESIS_ANSWER
    )
    await installStreamGate(page)
    await page.goto(PIXEL_AGENTS_URL)
    await dismissFirstLoad(page)

    const frame = await waitForOfficeFrame(page)
    await expect.poll(() => characterIds(frame)).toEqual([1])

    // Select + reset BEFORE sending (see selectPersistentAgent's own comment:
    // avoids the camera-follow lerp a click/selection-after-the-fact triggers,
    // and scopes the draw log this test reads to just this run).
    await selectPersistentAgent(frame, 1)
    await resetAnimationProbe(frame)

    await sendMessage(page, PROMPT_ALPHA)
    await expect(page.getByText(ANSWER_ALPHA_PART1)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(ANSWER_ALPHA_PART2)).toHaveCount(0)

    // T1 (DOM overlay): agent 1 reads as active while its run is held open.
    await expect
      .poll(async () => (await agentOverlayLocator(page, 1).textContent())?.trim())
      .not.toContain('Idle')

    // A second conversation, created through the assistant panel's own
    // switcher — a real conversation (not a launchAgent office affordance) —
    // projects a second, INDEPENDENT office character.
    await createNewConversation(page)
    await expect.poll(() => sortedCharacterIds(frame)).toEqual([1, 2])
    await expect
      .poll(async () => (await agentOverlayLocator(page, 2).textContent())?.trim())
      .toContain('Idle')

    // Agent 1 is unaffected by agent 2's creation/activation — still running,
    // still not idle (the assistant panel's active conversation and the office
    // run state are independent; issue #430's whole point).
    await expect
      .poll(async () => (await agentOverlayLocator(page, 1).textContent())?.trim())
      .not.toContain('Idle')

    // T2: ground-truth canvas signal — agent 1's calibrated sprite slot shows a
    // genuinely DIFFERENT identity set once its run is active than it did
    // before, exactly like tests/pixel-agents.e2e.ts's tool-driven run (mirrored
    // here for a plain no-tool streaming run: empirically confirmed to still
    // produce a typing<->settling sprite-class transition).
    const activeAt = (await readMessageLog(frame)).find(
      (message) => message.type === 'agentStatus' && message.id === 1 && message.status === 'active'
    )?.at
    expect(activeAt, "expected agent 1's run to have posted an active agentStatus").toBeDefined()
    const slot = await calibrateCharacterSlot(frame)
    const drawLog = await readAnimationDrawLog(frame)
    const now = Date.now()
    const idsBeforeActive = characterSpriteIdsInWindow(drawLog, slot, 0, activeAt!)
    const idsWhileActive = characterSpriteIdsInWindow(drawLog, slot, activeAt!, now)
    const sameIdentitySet =
      idsBeforeActive.size === idsWhileActive.size &&
      [...idsBeforeActive].every((id) => idsWhileActive.has(id))
    expect(sameIdentitySet, 'expected the sprite identity to change once the run went active').toBe(
      false
    )

    // Agent 2's own office activity log stays completely empty (proving
    // isolation at the SOURCE — activity.ts's per-agent stamping — not just
    // "the overlay happens to say Idle"): only its creation/status-waiting
    // entries, never a tool start or an active status.
    const agent2Log = (await readMessageLog(frame)).filter((message) => message.id === 2)
    expect(agent2Log.some((message) => message.type === 'agentToolStart')).toBe(false)
    expect(
      agent2Log.some((message) => message.type === 'agentStatus' && message.status === 'active')
    ).toBe(false)

    // Release the gate: agent 1 settles back to idle. Conversation two (not
    // one) is the active panel at this point (creating it made it active), so
    // this reads the completion off the office log/overlay — both driven
    // independently of which conversation the assistant panel shows — rather
    // than off a transcript bubble that would require switching back first.
    await releaseStreamGate(page)
    await expect
      .poll(async () =>
        readMessageLog(frame).then((log) =>
          log.some(
            (message) =>
              message.type === 'agentStatus' &&
              message.id === 1 &&
              message.status === 'waiting' &&
              message.at > activeAt!
          )
        )
      )
      .toBe(true)
    await expect
      .poll(async () => (await agentOverlayLocator(page, 1).textContent())?.trim())
      .toContain('Idle')
  })

  test('interactive office: launchAgent, focusAgent, and select-then-× close', async ({ page }) => {
    const PROMPT_ONE = 'Interactive office topic one message content.'
    const ANSWER_ONE = 'Answer for interactive office topic one.'
    const PROMPT_TWO = 'Interactive office topic two message content.'
    const ANSWER_TWO = 'Answer for interactive office topic two.'

    await enablePixelHooks(page)
    await installKeyedChatMock(page, (lastUserText) => {
      if (lastUserText.includes('topic two')) return ANSWER_TWO
      if (lastUserText.includes('topic one')) return ANSWER_ONE
      return SYNTHESIS_ANSWER
    })
    await page.goto(PIXEL_AGENTS_URL)
    await dismissFirstLoad(page)

    const frame = await waitForOfficeFrame(page)
    await expect.poll(() => characterIds(frame)).toEqual([1])

    // Conversation one: the pre-existing default (agent 1).
    await sendAndAwaitAnswer(page, PROMPT_ONE, ANSWER_ONE)
    // Conversation two, via the switcher (agent 2) — becomes active.
    await createNewConversation(page)
    await expect.poll(() => sortedCharacterIds(frame)).toEqual([1, 2])
    await sendAndAwaitAnswer(page, PROMPT_TWO, ANSWER_TWO)

    // --- office toolbar's launchAgent affordance -----------------------------
    // No real click can reach it here (see the module comment) — dispatched as
    // upstream's own webview would send it.
    await dispatchPixelClientMessage(frame, { type: 'launchAgent' })
    await expect.poll(() => sortedCharacterIds(frame)).toEqual([1, 2, 3])
    await openSwitcher(page)
    await expect(switcherListbox(page).getByRole('option')).toHaveCount(3)
    // The launched conversation is untitled (no message sent yet) and made
    // active automatically, same as the switcher's own "New conversation".
    await expect(conversationOption(page, PROMPT_TWO)).toHaveAttribute('aria-selected', 'false')
    await closeSwitcherIfOpen(page)

    // --- clicking a character: focusAgent -> assistant panel follows --------
    // A REAL click on agent 1's character (clickCharacterToSelect — see its own
    // comment): this is the exact code path a mouse click on a character always
    // was, and it turns out to ALSO send `focusAgent` (verified empirically,
    // not assumed — see the module comment's correction), not just set the
    // office's own visual selection.
    await clickCharacterToSelect(page, frame, 1)
    await expect(switcherTrigger(page)).toContainText(PROMPT_ONE)
    await expect(userBubble(page, PROMPT_ONE)).toBeVisible()
    await openSwitcher(page)
    await expect(conversationOption(page, PROMPT_ONE)).toHaveAttribute('aria-selected', 'true')
    await expect(conversationOption(page, PROMPT_TWO)).toHaveAttribute('aria-selected', 'false')
    await closeSwitcherIfOpen(page)

    // --- upstream's own select-then-× close ----------------------------------
    // Select agent 3 (the just-launched, untitled conversation) with the SAME
    // real click, then a real click on its overlay's own "Close agent" button
    // (rendered and visible only once selected — issue #430 unhid it).
    // Selecting agent 3 also re-focuses it (per the correction above), so this
    // exercises deleting the ACTIVE conversation, not a background one —
    // multi-conversation.e2e.ts's delete suite already covers the background
    // case generically; the agent-number bookkeeping this file cares about
    // (agent 3 retired, never reissued) is identical either way.
    await clickCharacterToSelect(page, frame, 3)
    await agentOverlayCloseButton(page, 3).click()

    await expect.poll(() => sortedCharacterIds(frame)).toEqual([1, 2])
    await openSwitcher(page)
    await expect(switcherListbox(page).getByRole('option')).toHaveCount(2)
    // The launched conversation is really gone (not just its office agent) —
    // its untitled row doesn't linger under a stale title.
    await expect(
      switcherListbox(page).getByRole('option', { name: 'New conversation' })
    ).toHaveCount(0)
    // Both original conversations are intact, exactly one of them active.
    await expect(conversationOption(page, PROMPT_ONE)).toHaveCount(1)
    await expect(conversationOption(page, PROMPT_TWO)).toHaveCount(1)
  })

  test('reload restores both agents with their seats and the active selection', async ({
    page
  }) => {
    const PROMPT_ONE = 'Reload-persistence conversation one content.'
    const ANSWER_ONE = 'Answer for reload-persistence conversation one.'
    const PROMPT_TWO = 'Reload-persistence conversation two content.'
    const ANSWER_TWO = 'Answer for reload-persistence conversation two.'

    await enablePixelHooks(page)
    await installKeyedChatMock(page, (lastUserText) => {
      if (lastUserText.includes('conversation two')) return ANSWER_TWO
      if (lastUserText.includes('conversation one')) return ANSWER_ONE
      return SYNTHESIS_ANSWER
    })
    await page.goto(PIXEL_AGENTS_URL)
    await dismissFirstLoad(page)

    let frame = await waitForOfficeFrame(page)
    await expect.poll(() => characterIds(frame)).toEqual([1])

    await sendAndAwaitAnswer(page, PROMPT_ONE, ANSWER_ONE)
    await createNewConversation(page)
    await expect.poll(() => sortedCharacterIds(frame)).toEqual([1, 2])
    await sendAndAwaitAnswer(page, PROMPT_TWO, ANSWER_TWO)

    // Make conversation one (agent 1) the active one again — a deliberate
    // choice, not "whichever was created last", so the restored SELECTION is
    // a genuine persistence signal rather than an accident of recency.
    await selectConversationByTitle(page, PROMPT_ONE)
    await expect(userBubble(page, PROMPT_ONE)).toBeVisible({ timeout: 30_000 })

    // Gate the reload on both conversation ROWS and both answers being fully
    // persisted — never a fixed sleep (see chatDatabasePersisted's comment).
    await expect
      .poll(() => chatDatabasePersisted(page, ANSWER_ONE, 2), {
        timeout: 30_000,
        message: "conversation one's row/run was never fully persisted before reload"
      })
      .toBe(true)
    await expect
      .poll(() => chatDatabasePersisted(page, ANSWER_TWO, 2), {
        timeout: 30_000,
        message: "conversation two's row/run was never fully persisted before reload"
      })
      .toBe(true)

    await page.reload()
    await closeSettingsIfOpen(page)

    frame = await waitForOfficeFrame(page)
    // Both agent numbers return — never reused/reissued (workspace-db.ts's
    // monotonic nextAgentNumber) — proving the two office characters really
    // are the SAME two conversations, not two fresh ones. Sorted (see
    // sortedCharacterIds): conversation two's more recent updatedAt means it
    // iterates first in the bootstrap handshake, so `getCharacters()`'s
    // insertion order is [2, 1] here, not [1, 2] — an incidental ordering,
    // not a persistence bug.
    await expect.poll(() => sortedCharacterIds(frame)).toEqual([1, 2])

    // The office's own bootstrap handshake re-selects agent 1 (conversation
    // one's persisted number), matching the restored active conversation.
    await expect
      .poll(() =>
        readMessageLog(frame).then((log) =>
          log.some((message) => message.type === 'agentSelected' && message.id === 1)
        )
      )
      .toBe(true)

    // The host side agrees: the switcher shows both conversations, with
    // conversation one's restored active state.
    await expect(switcherTrigger(page)).toContainText(PROMPT_ONE, { timeout: 30_000 })
    await openSwitcher(page)
    await expect(switcherListbox(page).getByRole('option')).toHaveCount(2)
    await expect(conversationOption(page, PROMPT_ONE)).toHaveAttribute('aria-selected', 'true')
    await expect(conversationOption(page, PROMPT_TWO)).toHaveAttribute('aria-selected', 'false')
  })
})
