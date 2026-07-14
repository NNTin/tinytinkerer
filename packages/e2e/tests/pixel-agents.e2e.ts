import { expect, test } from '@playwright/test'
import { dismissFirstLoad } from '../fixtures/first-load'
import {
  enableCodeExecPlugin,
  finalAnswerFragment,
  installReplayMock,
  loadCapture,
  loadScenario,
  sendMessage,
  toolResultFor,
  type Scenario
} from '../fixtures/mock-litellm'
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

// A scenario's `steps` array is untyped-index-addressable JSON (see
// mock-litellm.ts's loadScenario) — pulls the Nth step's prompt text so the
// spec reuses the EXACT captured prompt rather than retyping it (capture and
// replay must line up). Same helper as canvas-tool-verbs.e2e.ts /
// pixel-agents-activity.e2e.ts.
const promptText = (scenario: Scenario, index: number): string => {
  const step = scenario.steps[index]
  if (!step || !('prompt' in step)) {
    throw new Error(`scenario step ${index} is not a prompt step`)
  }
  return step.prompt
}

test('shows the persistent assistant agent and maps a chat run into office activity', async ({
  page
}) => {
  await enablePixelHooks(page)

  // Capture-grounded live run (see .agent/skills/e2e-testing/SKILL.md and
  // packages/e2e/pixel-agents-testing.md): the captured fixture's real model
  // turn issues an actual `run_javascript` tool call — a genuine tool event is
  // exactly what the office visualizes, so this replays REAL inference rather
  // than the synthetic no-tool mock. Captured ON /pixel-agents/ (same-shell
  // SOP rule) with the code-exec plugin enabled (see the scenario JSON).
  const fixture = loadCapture('pixel-agents-live-run')
  const scenario = loadScenario('pixel-agents-live-run')
  const mock = await installReplayMock(page, fixture)
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

  // Recreate the scenario's environment exactly (capture/replay must line up):
  // the fixture was captured with this Settings toggle enabled so the model
  // could issue a real run_javascript action.
  await enableCodeExecPlugin(page)

  // Selecting BEFORE the run (not clicking) keeps the character's screen
  // position stable for calibrateCharacterSlot (see its own comment for why),
  // and resetting the probe right after scopes the draw log that T2 reads
  // below to just this run's frames.
  await selectPersistentAgent(frame, 1)
  await resetAnimationProbe(frame)

  await sendMessage(page, promptText(scenario, 0))

  // T1 (DOM overlay, upstream's own e2e technique): the overlay only renders
  // non-idle activity text once the agent is selected AND actually doing
  // something, so this must follow both selectPersistentAgent and
  // sendMessage — checking any earlier would just see the pre-run "Idle" text
  // vacuously. The rendered panel also concatenates the folder name and the
  // "×" close button next to the activity label while selected (observed at
  // runtime: e.g. "IdleTinyTinkerer×"), so this checks for the literal 'Idle'
  // substring rather than exact/whole-text equality — the exact activity word
  // itself ('think'/'act'/'synthesize', per
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

  // The fragment is derived from the fixture's captured synthesis (never
  // hardcoded model prose); its rendering means the run fully settled.
  await expect(page.getByText(finalAnswerFragment(fixture))).toBeVisible({ timeout: 30_000 })
  expect(mock.replayError()).toBeUndefined()

  // Both sides of the pipeline (per the skill): the model context folded back
  // a REAL sandbox execution result for the captured run_javascript call...
  await expect
    .poll(() => toolResultFor(mock, 'run_javascript') !== undefined, {
      timeout: 30_000,
      message: 'the run_javascript result was never folded back into a model request'
    })
    .toBe(true)
  const sandboxResult = toolResultFor(mock, 'run_javascript') as
    | { ok?: boolean; result?: unknown; timedOut?: boolean }
    | undefined
  expect(sandboxResult?.ok).toBe(true)
  expect(sandboxResult?.result).toBe(5)

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

  // ...and the office UI actually projected the REAL tool as its own
  // agentToolStart entry (packages/app/pixel-agents/src/activity.ts maps
  // agent.tool.* events to `${stepId}:${toolId}`; pixelToolName('run_javascript')
  // classifies as 'Write' — it matches neither the Read nor the Bash pattern).
  const fullLogForToolCheck = await readMessageLog(frame)
  const runJavascriptStart = fullLogForToolCheck.find(
    (message) => message.type === 'agentToolStart' && message.toolId?.endsWith(':run_javascript')
  )
  expect(runJavascriptStart, 'expected a real run_javascript agentToolStart entry').toBeDefined()
  expect(runJavascriptStart?.toolName).toBe('Write')

  // T1: after the run settles, the overlay returns to the idle label (still
  // rendered alongside the folder name/close button — see the comment above).
  await expect
    .poll(async () => (await agentOverlayLocator(page, 1).textContent())?.trim())
    .toContain('Idle')

  // T2(b)/(c): the ground-truth canvas signal that the character actually
  // animated in response to activity, not just that protocol messages were
  // delivered. A ReAct run with a real tool call structurally produces a
  // 'think' step (toolName 'Read') and at least one 'Write'-classified entry
  // (the 'act' step wrapping the tool call, the run_javascript tool call
  // itself, and the 'synthesize' step are ALL classified 'Write' —
  // see stepToolName/pixelToolName) — asserted explicitly, rather than
  // assumed, so a future change to agent-runtime-base's step shape or the
  // activity classifier fails here with a clear message instead of a
  // confusing "0 sprite identities" failure below. The split point is the
  // LAST 'Write' entry — see the comment on writeStarts below for why.
  const fullLog = await readMessageLog(frame)
  const toolStarts = fullLog.filter((message) => message.type === 'agentToolStart')
  const readStart = toolStarts.find((message) => message.toolName === 'Read')
  // The LAST 'Write' entry, not the first: a tool-bearing run produces SEVERAL
  // 'Write'-classified agentToolStart entries in sequence (the 'act' step
  // wrapping the tool call, the run_javascript tool call itself, and finally
  // the 'synthesize' step — see stepToolName/pixelToolName), and empirically
  // (observed running this spec --repeat-each=20) the earliest ones land too
  // close to run start for the character's sprite to have visibly transitioned
  // yet, making the before/after windows below coincide on the same identity
  // set ~half the time. The LAST entry is always the 'synthesize' step, the
  // same single entry the original synthetic no-tool run relied on, so this
  // keeps the split point at "the answer is being composed" regardless of how
  // many earlier Write-classified steps a real tool call adds.
  const writeStarts = toolStarts.filter((message) => message.toolName === 'Write')
  const writeStart = writeStarts[writeStarts.length - 1]
  if (!readStart || !writeStart) {
    throw new Error(
      "expected the replayed run to produce both a 'Read' (think step) and a 'Write' " +
        '(act/tool/synthesize step) agentToolStart entry in messageLog, got toolNames: ' +
        `${JSON.stringify(toolStarts.map((message) => message.toolName))}. Either the ` +
        "runtime's step shape (packages/app/agent-core/src/runtime/agent-runtime-base.ts) or " +
        'the activity classifier (packages/app/pixel-agents/src/activity.ts) may have changed.'
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
