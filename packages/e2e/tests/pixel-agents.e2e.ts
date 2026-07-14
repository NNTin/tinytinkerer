import { expect, test } from '@playwright/test'
import { dismissFirstLoad } from '../fixtures/first-load'
import { installChatMock, sendMessage, SYNTHESIS_ANSWER } from '../fixtures/mock-litellm'
import {
  agentOverlayLocator,
  calibrateCharacterSlot,
  characterIds,
  characterSpriteIdsInWindow,
  enablePixelHooks,
  PIXEL_AGENTS_URL,
  readAnimationDrawLog,
  readAnimationTotals,
  readMessageLog,
  resetAnimationProbe,
  savedOfficeLayoutVersion,
  selectPersistentAgent,
  waitForOfficeFrame
} from '../fixtures/pixel-agents'

test.use({ viewport: { width: 1280, height: 800 } })

test('shows the persistent assistant agent and maps a chat run into office activity', async ({
  page
}) => {
  await enablePixelHooks(page)
  await installChatMock(page)
  await page.goto(PIXEL_AGENTS_URL)
  await dismissFirstLoad(page)

  await expect(page.getByRole('main', { name: 'TinyTinkerer Pixel Agents' })).toBeVisible()
  const officeFrame = page.frameLocator('iframe[title="Pixel Agents office"]')
  await expect(officeFrame.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await expect(officeFrame.getByTitle('Zoom in (Ctrl+Scroll)')).toBeVisible()
  await expect(officeFrame.getByRole('button', { name: 'Layout' })).toBeVisible()
  await expect(officeFrame.getByTitle('Settings')).toBeHidden()

  await officeFrame.getByRole('button', { name: 'Layout' }).click()
  await officeFrame.getByTitle('Paint floor tiles').click()
  await officeFrame
    .locator('canvas')
    .first()
    .click({ position: { x: 360, y: 240 } })
  await expect.poll(() => savedOfficeLayoutVersion(page)).toBe(1)

  const frame = await waitForOfficeFrame(page)
  await expect.poll(() => characterIds(frame)).toEqual([1])

  // Selecting BEFORE the run (not clicking) keeps the character's screen
  // position stable for calibrateCharacterSlot (see its own comment for why),
  // and resetting the probe right after scopes the draw log that T2 reads
  // below to just this run's frames.
  await selectPersistentAgent(frame, 1)
  await resetAnimationProbe(frame)

  await sendMessage(page, 'Show this assistant working in the office.')

  // T1 (DOM overlay, upstream's own e2e technique): the overlay only renders
  // non-idle activity text once the agent is selected AND actually doing
  // something, so this must follow both selectPersistentAgent and
  // sendMessage — checking any earlier would just see the pre-run "Idle" text
  // vacuously. The rendered panel also concatenates the folder name and the
  // "×" close button next to the activity label while selected (observed at
  // runtime: e.g. "IdleTinyTinkerer×"), so this checks for the literal 'Idle'
  // substring rather than exact/whole-text equality — the exact activity word
  // itself ('think'/'synthesize', per
  // packages/app/pixel-agents/src/activity.ts's humanize(stepKind)) is
  // deliberately NOT pinned, so this survives cosmetic wording changes to step
  // labels.
  await expect
    .poll(async () => (await agentOverlayLocator(page, 1).textContent())?.trim())
    .not.toContain('Idle')

  // T2(a): liveness — the canvas keeps rendering during the run at all (a
  // frozen canvas would otherwise pass every other assertion below vacuously,
  // since they only ever check identities recorded so far).
  const preRunTotals = await readAnimationTotals(frame)
  await expect
    .poll(async () => (await readAnimationTotals(frame)).drawImageCalls, {
      message: 'drawImage calls never increased — the office canvas appears frozen'
    })
    .toBeGreaterThan(preRunTotals.drawImageCalls)

  await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

  await expect
    .poll(async () => {
      const log = await readMessageLog(frame)
      return {
        active: log.some(
          (message) => message.type === 'agentStatus' && message.status === 'active'
        ),
        activity: log.some((message) => message.type === 'agentToolStart'),
        waiting: log.some(
          (message) => message.type === 'agentStatus' && message.status === 'waiting'
        )
      }
    })
    .toEqual({ active: true, activity: true, waiting: true })

  // T1: after the run settles, the overlay returns to the idle label (still
  // rendered alongside the folder name/close button — see the comment above).
  await expect
    .poll(async () => (await agentOverlayLocator(page, 1).textContent())?.trim())
    .toContain('Idle')

  // T2(b)/(c): the ground-truth canvas signal that the character actually
  // animated in response to activity, not just that protocol messages were
  // delivered. The synthetic no-tool run structurally produces a 'think' step
  // (toolName 'Read') then a 'synthesize' step (toolName 'Write') — asserted
  // explicitly, rather than assumed, so a future change to agent-runtime-base's
  // step shape fails here with a clear message instead of a confusing
  // "0 sprite identities" failure below.
  const fullLog = await readMessageLog(frame)
  const toolStarts = fullLog.filter((message) => message.type === 'agentToolStart')
  const readStart = toolStarts.find((message) => message.toolName === 'Read')
  const writeStart = toolStarts.find((message) => message.toolName === 'Write')
  if (!readStart || !writeStart) {
    throw new Error(
      "expected the synthetic no-tool run to produce both a 'Read' (think step) and a " +
        "'Write' (synthesize step) agentToolStart entry in messageLog, got toolNames: " +
        `${JSON.stringify(toolStarts.map((message) => message.toolName))}. The synthetic run's ` +
        'step shape (packages/app/agent-core/src/runtime/agent-runtime-base.ts think/synthesize ' +
        'steps) may have changed.'
    )
  }

  const drawLog = await readAnimationDrawLog(frame)
  const slot = await calibrateCharacterSlot(frame)
  const now = Date.now()

  const runIdentities = characterSpriteIdsInWindow(drawLog, slot, 0, now)
  expect(runIdentities.size).toBeGreaterThanOrEqual(2)

  const beforeWrite = characterSpriteIdsInWindow(drawLog, slot, 0, writeStart.at)
  const afterWrite = characterSpriteIdsInWindow(drawLog, slot, writeStart.at, now)
  const sameIdentitySet =
    beforeWrite.size === afterWrite.size && [...beforeWrite].every((id) => afterWrite.has(id))
  expect(sameIdentitySet).toBe(false)

  await expect.poll(() => characterIds(frame)).toEqual([1])
})
