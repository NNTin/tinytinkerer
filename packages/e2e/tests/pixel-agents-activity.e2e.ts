import { expect, test, type Frame, type Page } from '@playwright/test'
import { openCanvasWithChat, sendCanvasMessage } from '../fixtures/canvas-chat'
import { dismissFirstLoad } from '../fixtures/first-load'
import {
  enableReasoningActivity,
  finalAnswerFragment,
  installChatMock,
  sendMessage,
  SYNTHESIS_ANSWER,
  toolResultFor,
  type Scenario
} from '../fixtures/mock-litellm'
import {
  characterIds,
  enablePixelHooks,
  PIXEL_AGENTS_URL,
  readMessageLog,
  savedOfficeLayout,
  waitForOfficeFrame
} from '../fixtures/pixel-agents'

// Pixel Agents is a PASSIVE stage: it projects live chat run/step/tool events
// into the office visualization, and useLiveChatActivity
// (packages/app/app-shell/src/live-chat-activity.ts) deliberately seeds a
// seen-event set on boot so persisted chat history is NEVER replayed as fresh
// office activity. tests/pixel-agents.e2e.ts covers the live half with a
// synthetic no-tool chat; nothing proved the SUPPRESSION half against real
// traffic. Conversations are shared across every shell on the origin (one
// 'tinytinkerer' IndexedDB; the most recent conversation is restored on boot
// via conversations.orderBy('updatedAt').last()), so a REAL captured canvas
// run — whose agent.tool.* events would each map to an office 'agentToolStart'
// if delivered (packages/app/pixel-agents/src/activity.ts) — restored on
// /pixel-agents/ must render as transcript history while the office stays
// quiet, and a NEW live run on the same page must still animate: the seeding
// boundary, both sides. The second test covers office-layout persistence's
// missing half: the existing spec proves the paint→save WRITE, nothing proved
// the RESTORE (after a reload the boot handshake must deliver the saved
// layout, not the bundled default).
//
// Only LiteLLM inference is mocked (see .agent/skills/e2e-testing/SKILL.md):
// the canvas phase replays the captured `canvas-thumbnail-empty` fixture —
// same shell, same settings toggle, same prompt as the capture — through
// fixtures/canvas-chat.ts, and the live phase uses the synthetic no-tool chat
// mock, exactly like the existing pixel-agents spec.

// A scenario's `steps` array is untyped-index-addressable JSON (see
// mock-litellm.ts's loadScenario) — this pulls the Nth step's prompt text so
// the spec reuses the EXACT captured prompt rather than retyping it (capture
// and replay must line up). Same helper as canvas-tool-verbs.e2e.ts.
const promptText = (scenario: Scenario, index: number): string => {
  const step = scenario.steps[index]
  if (!step || !('prompt' in step)) {
    throw new Error(`scenario step ${index} is not a prompt step`)
  }
  return step.prompt
}

// The office's messageLog records only scalar envelope fields (type / status /
// toolId / …) — never the 'layoutLoaded' message's layout payload (verified
// against the vendored upstream bundle's messageLog.push call). So the restore
// assertion records the actual layout payloads itself: this passive listener
// runs in every document the context boots (addInitScript reaches the
// sandboxed office iframe too) and stashes each layoutLoaded layout. Pure
// observation — nothing is intercepted, altered, or answered.
//
// Host -> iframe messages are posted RAW (not enveloped): upstream's own
// PostMessageTransport reads `event.data` directly as the message once the
// injected acquireVsCodeApi shim makes it the active transport (see
// pixel-agents-stage.tsx's postToPixelAgents), so `event.data` here already
// IS the PixelServerMessage, with no channel/direction wrapper to check.
const recordLayoutLoads = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      const data = event.data as { type?: unknown; layout?: unknown } | null
      if (!data || typeof data !== 'object' || data.type !== 'layoutLoaded') return
      const target = window as unknown as { __ttLayoutLoads?: unknown[] }
      ;(target.__ttLayoutLoads ??= []).push(data.layout)
    })
  })
}

const layoutLoads = (frame: Frame): Promise<unknown[]> =>
  frame.evaluate(() => (window as unknown as { __ttLayoutLoads?: unknown[] }).__ttLayoutLoads ?? [])

// "The final answer is VISIBLE" is a live-store signal, not a persistence
// signal: chat events are appended to the shared 'tinytinkerer' IndexedDB
// asynchronously (db.ts's `events` table, records = ChatEvent +
// conversationId), so navigating away right after the answer renders can
// unload the document while the tail of the run's writes — the final answer
// and 'agent.run.completed' events — is still in flight, and the conversation
// restored on /pixel-agents/ would be missing exactly what Phase 2 asserts on.
// This polls the SAME shared database the cross-shell restore reads (the very
// mechanism under test) until the run is fully persisted: an
// 'agent.run.completed' event exists AND the final answer text has landed in
// some persisted event. Pure observation of real writes — no sleeps.
const persistedRunComplete = (page: Page, fragment: string): Promise<boolean> =>
  page.evaluate(
    (needle) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('tinytinkerer')
        open.onerror = () => reject(open.error ?? new Error('Could not open the chat database'))
        open.onsuccess = () => {
          const database = open.result
          if (!database.objectStoreNames.contains('events')) {
            database.close()
            resolve(false)
            return
          }
          const request = database.transaction('events').objectStore('events').getAll()
          request.onerror = () =>
            reject(request.error ?? new Error('Could not read persisted chat events'))
          request.onsuccess = () => {
            const events = request.result as Array<{ type?: unknown }>
            resolve(
              events.some((event) => event.type === 'agent.run.completed') &&
                JSON.stringify(events).includes(needle)
            )
            database.close()
          }
        }
      }),
    fragment
  )

test.use({ viewport: { width: 1280, height: 800 } })

test('a real captured canvas run is history, not office activity', async ({ page }) => {
  await enablePixelHooks(page)

  // Phase 1 — replay the captured run on /canvas/, the shell it was captured
  // in (SOP: same shell, same settings, same prompt). The run carries REAL
  // tool events: the model calls `thumbnail` on the empty canvas and the
  // failure folds back as a tool result before the final synthesis.
  const { mock, fixture, scenario } = await openCanvasWithChat(page, 'canvas-thumbnail-empty')
  await enableReasoningActivity(page)
  await sendCanvasMessage(page, promptText(scenario, 0))
  await expect
    .poll(() => toolResultFor(mock, 'thumbnail'), {
      timeout: 30_000,
      message: 'the thumbnail result was never folded back into a model request'
    })
    .toEqual(expect.stringContaining('thumbnail: nothing to export'))
  // The fragment is derived from the fixture's captured synthesis (never
  // hardcoded model prose); its rendering means the run fully settled.
  await expect(page.getByText(finalAnswerFragment(fixture))).toBeVisible({ timeout: 30_000 })
  expect(mock.replayError()).toBeUndefined()
  // Gate the navigation on PERSISTENCE, not visibility (see persistedRunComplete):
  // without this, the goto below can unload the page mid-write and Phase 2
  // restores a conversation missing its final events.
  await expect
    .poll(() => persistedRunComplete(page, finalAnswerFragment(fixture)), {
      timeout: 30_000,
      message: 'the replayed run was never fully persisted to the shared conversation database'
    })
    .toBe(true)

  // Phase 2 — same page, same origin → /pixel-agents/. The conversation (now
  // carrying real run/step/tool events) is restored as the most-recent one:
  // it must show up as transcript HISTORY while the office stays quiet.
  await page.goto(PIXEL_AGENTS_URL)
  await dismissFirstLoad(page)
  await expect(page.getByText(finalAnswerFragment(fixture))).toBeVisible({ timeout: 30_000 })

  const frame = await waitForOfficeFrame(page)
  await expect.poll(() => characterIds(frame)).toEqual([1])
  // Positive signals first (never a fixed sleep): the bootstrap handshake ends
  // with an agentStatus 'waiting' — once it and the character have landed, the
  // boot has delivered everything it was ever going to for restored history.
  await expect
    .poll(async () =>
      (await readMessageLog(frame)).some(
        (message) => message.type === 'agentStatus' && message.status === 'waiting'
      )
    )
    .toBe(true)
  // The suppression itself: the restored run's real agent.tool.*/run.started
  // events were seeded as already seen, so nothing animated — no tool
  // activity, no 'active' status, ever.
  const historyLog = await readMessageLog(frame)
  expect(historyLog.filter((message) => message.type === 'agentToolStart')).toEqual([])
  expect(
    historyLog.filter((message) => message.type === 'agentStatus' && message.status === 'active')
  ).toEqual([])

  // Phase 3 — the live side of the boundary. A fresh synthetic no-tool mock,
  // deliberately NOT a capture replay: the mock-litellm replay drift check
  // matches a captured exchange against THIS request's folded-back tool-result
  // count at the same cursor position, but Phase 1's restored conversation has
  // already folded its own (canvas) tool results back into context by the time
  // this phase's live run starts — a fresh capture's exchange #0 expects
  // toolResultCount 0 and would drift-fail immediately against a request that
  // is really exchange #0 of a NEW turn appended after history. Capture-
  // grounded live coverage for Pixel Agents therefore lives entirely in
  // tests/pixel-agents.e2e.ts (a single fresh conversation, no restored
  // history), and this phase only needs a plain live signal (something
  // animates) — the synthetic mock is enough and keeps the drift check
  // satisfiable. The LiteLLM upstream is a module-level slot the new install
  // reassigns, and the re-registered /api/** route shadows the earlier one
  // (Playwright runs the newest matching handler; pipeToEdge always
  // fulfills), so new chat requests are served by THIS mock. A new message
  // must animate the office — proving history was suppressed by seeding, not
  // by a dead pipeline.
  const liveMock = await installChatMock(page)
  await sendMessage(page, 'Now do a live run in the office.')
  await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })
  expect(liveMock.requestBodies().length).toBeGreaterThan(0)
  await expect
    .poll(async () => {
      const log = await readMessageLog(frame)
      const lastActive = log.reduce(
        (last, message, index) =>
          message.type === 'agentStatus' && message.status === 'active' ? index : last,
        -1
      )
      return {
        active: lastActive >= 0,
        activity: log.some((message) => message.type === 'agentToolStart'),
        // 'waiting' AFTER the run's 'active' — the boot-time 'waiting' asserted
        // above cannot satisfy this, so the run really settled back to idle.
        waitingAfterActive:
          lastActive >= 0 &&
          log
            .slice(lastActive + 1)
            .some((message) => message.type === 'agentStatus' && message.status === 'waiting')
      }
    })
    .toEqual({ active: true, activity: true, waitingAfterActive: true })
})

test('office layout restores from IndexedDB across reload', async ({ page }) => {
  await enablePixelHooks(page)
  await recordLayoutLoads(page)
  await installChatMock(page)
  await page.goto(PIXEL_AGENTS_URL)
  await dismissFirstLoad(page)

  let frame = await waitForOfficeFrame(page)
  await expect.poll(() => characterIds(frame)).toEqual([1])
  // First boot: no saved workspace exists yet, so the handshake delivered the
  // bundled default layout — captured here as the baseline the restored layout
  // must differ from (the default also carries version 1, so a bare version
  // check could never discriminate saved from default).
  await expect.poll(() => layoutLoads(frame)).toHaveLength(1)
  const defaultLayout = (await layoutLoads(frame))[0]

  // Paint one floor tile — the same real interaction the existing spec's
  // write-side test drives.
  const officeFrame = page.frameLocator('iframe[title="Pixel Agents office"]')
  await officeFrame.getByRole('button', { name: 'Layout' }).click()
  await officeFrame.getByTitle('Paint floor tiles').click()
  await officeFrame
    .locator('canvas')
    .first()
    .click({ position: { x: 360, y: 240 } })

  // Wait for the persisted layout to actually DIFFER from the boot-delivered
  // default (stronger than the write test's version check: it can never pass
  // vacuously off an untouched-default save), then pin the saved object.
  await expect
    .poll(async () => {
      const saved = await savedOfficeLayout(page)
      return saved !== null && JSON.stringify(saved) !== JSON.stringify(defaultLayout)
    })
    .toBe(true)
  const saved = await savedOfficeLayout(page)
  expect(saved).toMatchObject({ version: 1 })

  // The restore: a reload boots a fresh office document, whose handshake must
  // deliver the SAVED layout, not the bundled default.
  await page.reload()
  await dismissFirstLoad(page)
  frame = await waitForOfficeFrame(page)
  await expect.poll(() => characterIds(frame)).toEqual([1])
  await expect
    .poll(async () =>
      (await readMessageLog(frame)).some((message) => message.type === 'layoutLoaded')
    )
    .toBe(true)
  const restored = await layoutLoads(frame)
  expect(restored).toHaveLength(1)
  expect(restored[0]).toEqual(saved)
  expect(restored[0]).not.toEqual(defaultLayout)
})
