import { test, expect, type Locator, type Page } from '@playwright/test'
import { CANVAS_FRAME, minimizeChat, readSnapshot } from '../fixtures/canvas'
import { openCanvasWithChat, sendCanvasMessage } from '../fixtures/canvas-chat'
import {
  capturedToolCallArgs,
  enableReasoningActivity,
  finalAnswerFragment,
  toolResultFor,
  type Scenario
} from '../fixtures/mock-litellm'

// End-to-end proof of the safer-workflow canvas verbs — `preview` (dry-run +
// rendered image of the hypothetical scene), `thumbnail` (PNG snapshot as a
// media handle), `pick` (read/await the user's selection, with `fields`
// projection) — introduced alongside the media/token split (tool results carry
// `{mediaRef, description, width, height, mimeType}` handles in model context;
// the UI resolves `![…](media:…)` back to data URLs). Coverage before this spec
// was unit tests + hermetic canvas e2e (no chat) — nothing proved the full loop:
// model tool_call → agent runtime → tool registry → app-bridge → sandboxed
// Excalidraw iframe → media handling → UI. A real regression already slipped
// through this gap and was only caught by Sentry in a live preview
// (TINYTINKERER-FRONTEND-1C).
//
// Only LiteLLM inference is mocked (fixtures/canvas-chat.ts's
// openCanvasWithChat, backed by mock-litellm.ts's 'replay' mode): the edge
// worker, the bridge, the sandboxed Excalidraw iframe, the tool registry, and
// the media pipeline are all real — and so is the MODEL. Each test replays a
// fixture captured verbatim from real inference against a live PR preview (see
// packages/e2e/fixtures/captures/*.json + .agent/skills/e2e-testing/SKILL.md):
// the drawing, the verb calls, and the final prose are all real captured
// tokens, not hand-built tool_calls — the model drives every scene mutation
// for real, through the real bridge, exactly as it did at capture time.

test.use({ viewport: { width: 1280, height: 800 } })

// The per-turn panel auto-EXPANDS while the turn is live and auto-COLLAPSES
// the instant it settles (turn-activity-panel.tsx's `useEffect` on `isLive`).
// Replay (unlike a real model) serves the remaining exchanges of a run near-
// instantly — no real inference latency — so "the tool result folded back"
// (this suite's usual poll signal) can fire WHILE the run is still finishing
// its synthesis turn. Calling expandTimeline at that point can win a click
// against a panel that is still live (already expanded, so the click is
// skipped) only to have it auto-collapse a beat later when the run actually
// settles — undoing it. Waiting for the composer's "Send" button to
// reappear (the run has FULLY stopped, so the one-time live→settled
// auto-collapse has already fired and nothing will toggle the panel again
// except our own click) removes the race entirely.
const expandTimeline = async (page: Page): Promise<Locator> => {
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
    timeout: 30_000
  })
  const toggle = page.getByRole('button', { name: 'Toggle reasoning and activity' }).last()
  await toggle.waitFor({ state: 'visible', timeout: 30_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return page.locator('section', { has: page.getByText('Reasoning & activity') }).last()
}

// A scenario's `steps` array is untyped-index-addressable JSON (see
// mock-litellm.ts's loadScenario) — this pulls the Nth step's prompt text so a
// spec reuses the EXACT captured prompt rather than retyping it (capture and
// replay must line up).
const promptText = (scenario: Scenario, index: number): string => {
  const step = scenario.steps[index]
  if (!step || !('prompt' in step)) {
    throw new Error(`scenario step ${index} is not a prompt step`)
  }
  return step.prompt
}

test.describe('canvas tool verbs: preview / thumbnail / pick', () => {
  test('thumbnail: folds back as a media handle (no base64) and resolves in the activity panel + transcript', async ({
    page
  }) => {
    const { mock, scenario } = await openCanvasWithChat(page, 'canvas-thumbnail')
    // The floating chat widget (the canvas's default composer shell) renders
    // the Reasoning & Activity panel directly — this is the regression test
    // for the bug where it didn't.
    await enableReasoningActivity(page)

    // One prompt drives BOTH the draw and the thumbnail (the captured model
    // chained them itself) — the model draws for real through the bridge.
    await sendCanvasMessage(page, promptText(scenario, 0))

    await expect
      .poll(() => toolResultFor(mock, 'thumbnail'), {
        timeout: 30_000,
        message: 'thumbnail result was never folded back into a model request'
      })
      .toMatchObject({ ok: true, elementCount: 2, missingIds: [] })

    // The model-driven draw landed for real: the persisted snapshot has the 2
    // elements the thumbnail result also reports.
    await expect
      .poll(async () => (await readSnapshot(page))?.elements?.length, { timeout: 10_000 })
      .toBe(2)

    const result = toolResultFor(mock, 'thumbnail') as {
      media?: Array<{ mediaRef?: string }>
    }
    const mediaRef = result.media?.[0]?.mediaRef
    expect(mediaRef).toMatch(/^media:/)
    // The token split (issue: media/token split): the model context never sees
    // the raw base64 — only the compact mediaRef handle.
    expect(mock.requestBodies().join('\n')).not.toContain('data:image/png;base64,')

    const panel = await expandTimeline(page)
    await expect(panel.getByText('Using thumbnail')).toBeVisible()
    await panel.getByText('thumbnail', { exact: true }).click()
    // The canvas verbs ship no owner ActivitySummarizer, so the panel falls back
    // to its neutral default — an "Unknown" outcome badge (neither ok/error/warn
    // applies with no tool-specific knowledge) — but STILL renders the image
    // section generically via partitionToolResultMedia, which is the real thing
    // under test here.
    await expect(panel.locator('[data-activity-status="unknown"]').first()).toBeVisible()
    await expect(panel.locator('img[src^="data:image/png"]')).toBeVisible()

    // Media-registry round-trip: the synthesized answer's embedded image
    // resolves through the UI's media registry back to a real data URL in the
    // transcript — proof the mediaRef re-keying (applyMediaRekey) actually
    // works: the captured answer embeds the OLD (capture-time) uuid, so this
    // can only resolve if replay swapped it for this run's real handle.
    const figure = page.locator('figure[data-tt-image]').first()
    await expect(figure).toBeVisible({ timeout: 30_000 })
    await expect(figure.locator('img')).toHaveAttribute('src', /^data:/)
  })

  test('preview is a dry-run: proposes a change, renders it, and commits nothing', async ({
    page
  }) => {
    const { mock, fixture, scenario } = await openCanvasWithChat(page, 'canvas-preview')
    await enableReasoningActivity(page)

    // Turn 1: the model draws a single red rectangle for real.
    await sendCanvasMessage(page, promptText(scenario, 0))
    await expect
      .poll(() => toolResultFor(mock, 'draw'), {
        timeout: 30_000,
        message: 'draw result was never folded back into a model request'
      })
      .toMatchObject({ ok: true })
    await expect
      .poll(async () => (await readSnapshot(page))?.elements?.length, { timeout: 10_000 })
      .toBe(1)

    // Turn 2: preview a green diamond WITHOUT applying it.
    await sendCanvasMessage(page, promptText(scenario, 1))

    await expect
      .poll(() => toolResultFor(mock, 'preview'), {
        timeout: 30_000,
        message: 'preview result was never folded back into a model request'
      })
      .toMatchObject({ ok: true, verb: 'draw', wouldChange: true, thumbnailReason: 'rendered' })

    const result = toolResultFor(mock, 'preview') as {
      summary?: { adds: number }
      media?: Array<{ mediaRef?: string }>
    }
    expect(result.summary?.adds).toBe(1)
    expect(result.media?.[0]?.mediaRef).toMatch(/^media:/)

    // The core safety guarantee: the dry-run committed NOTHING to the real
    // scene. Anchor on the run's final answer first: readSnapshot reads the
    // harness's persisted snapshot, written on a debounced (600ms) `onChange`,
    // so a read taken right after the fold-back could still see the
    // pre-commit snapshot and pass vacuously. By the time the synthesized
    // answer renders, a wrongful commit's debounced write would have landed —
    // the check below can then only pass if nothing was committed. The
    // fragment is derived from the fixture (never hardcoded model prose).
    await expect(page.getByText(finalAnswerFragment(fixture))).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => (await readSnapshot(page))?.elements?.length, { timeout: 10_000 })
      .toBe(1)

    const panel = await expandTimeline(page)
    await expect(panel.getByText('Using preview')).toBeVisible()
    await panel.getByText('preview', { exact: true }).click()
    await expect(panel.locator('img[src^="data:image/png"]')).toBeVisible()
  })

  test('pick current + fields projection: a real in-iframe selection round-trips with the requested detail', async ({
    page
  }) => {
    const { mock, scenario } = await openCanvasWithChat(page, 'canvas-pick-fields')
    // This scenario enables no settings (settings: []) — no reasoning/activity
    // panel to assert here.

    // Turn 1: the model draws a red rectangle + a blue ellipse for real.
    await sendCanvasMessage(page, promptText(scenario, 0))
    await expect
      .poll(() => toolResultFor(mock, 'draw'), {
        timeout: 30_000,
        message: 'draw result was never folded back into a model request'
      })
      .toMatchObject({ ok: true })
    await expect
      .poll(async () => (await readSnapshot(page))?.elements?.length, { timeout: 10_000 })
      .toBe(2)

    // A real user selection, driven inside the sandboxed iframe: click the
    // canvas (to focus it) then select-all — mirrors the scenario's own
    // clickCanvas({x:700,y:700}) + press(Control+a) steps. The floating chat
    // widget overlays that part of the canvas, so minimize it first (exactly
    // like capture-llm-stream.mjs's clickCanvas step does) or the click never
    // reaches the canvas and Control+a has nothing focused to act on.
    await minimizeChat(page)
    const frame = page.frameLocator(CANVAS_FRAME)
    await frame
      .locator('.excalidraw__canvas')
      .first()
      .click({ position: { x: 700, y: 700 }, force: true })
    await page.keyboard.press('Control+a')

    // Turn 2: the model calls pick(mode: 'current', detail: 'full', fields: [...all 17]).
    // Step index 3, not 1 — this scenario's steps are
    // [prompt, clickCanvas, press, prompt] (see captures/scenarios/canvas-pick-fields.json).
    await sendCanvasMessage(page, promptText(scenario, 3))

    await expect
      .poll(() => toolResultFor(mock, 'pick'), {
        timeout: 30_000,
        message: 'pick result was never folded back into a model request'
      })
      .toMatchObject({ ok: true, mode: 'current', selectedCount: 2 })

    const result = toolResultFor(mock, 'pick') as { elements?: Array<Record<string, unknown>> }
    expect(result.elements).toHaveLength(2)
    for (const element of result.elements ?? []) {
      // Identity (id/type/kind) is always included; `detail: 'full'` + the
      // model's all-17-field request means style + geometry survive too. A
      // robust SUBSET check (not an exact key list — the model asked for many
      // fields, several of which a plain rectangle/ellipse doesn't carry, e.g.
      // `text`/`linear`/`image`, and are silently skipped by the projection).
      expect(Object.keys(element)).toEqual(
        expect.arrayContaining(['id', 'type', 'kind', 'x', 'y', 'width', 'height', 'style'])
      )
      // Never a raw image payload in model context (the media/token split).
      expect(element).not.toHaveProperty('dataUrl')
    }
  })

  test('pick interactive: the in-iframe toast blocks the run, then a real click resolves it', async ({
    page
  }) => {
    const { mock, fixture, scenario } = await openCanvasWithChat(page, 'canvas-pick-interactive')
    await enableReasoningActivity(page)

    // Turn 1: the model draws one large filled red rectangle for real. A
    // FILLED shape is required for the later click to hit-test — Excalidraw
    // only hit-tests a transparent-background shape on its stroke outline —
    // and the captured draw already asked for a solid light-red fill.
    await sendCanvasMessage(page, promptText(scenario, 0))
    await expect
      .poll(() => toolResultFor(mock, 'draw'), {
        timeout: 30_000,
        message: 'draw result was never folded back into a model request'
      })
      .toMatchObject({ ok: true })
    await expect
      .poll(async () => (await readSnapshot(page))?.elements?.length, { timeout: 10_000 })
      .toBe(1)
    const snapshot = await readSnapshot(page)
    const drawnId = (snapshot?.elements?.[0] as { id?: string } | undefined)?.id
    expect(drawnId, 'the model-drawn element has an id in the persisted snapshot').toBeTruthy()

    // Turn 2: ask for an interactive pick — deliberately NOT awaited (the run
    // blocks on the user, so there is nothing to settle yet).
    await sendCanvasMessage(page, promptText(scenario, 1))

    // The toast carries the EXACT prompt the model passed to pick(), parsed
    // out of the fixture rather than hardcoded.
    const pickArgs = capturedToolCallArgs(fixture, 'pick') as { prompt?: string } | undefined
    expect(pickArgs?.prompt, 'fixture never captured a pick tool call').toBeTruthy()
    const toast = page.frameLocator(CANVAS_FRAME).locator('.Toast__message')
    await expect(toast).toBeVisible({ timeout: 30_000 })
    await expect(toast).toContainText(pickArgs!.prompt!)

    // Genuinely blocking: the pick has not resolved while only the toast shows.
    expect(toolResultFor(mock, 'pick')).toBeUndefined()

    // Collapse the floating chat so it stops overlaying the canvas, then click
    // the drawn element for real (a real pointer click, not a bridge call).
    // `draw` scrolls-to-fit its new content, which for one shape well within
    // the viewport centers it at zoom 100% — so the iframe's own center, not
    // the element's scene x/y, is where it lands on screen.
    await minimizeChat(page)
    const iframe = page.locator(CANVAS_FRAME)
    const box = await iframe.boundingBox()
    if (!box) throw new Error('canvas iframe has no bounding box')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    await expect
      .poll(() => toolResultFor(mock, 'pick'), {
        timeout: 30_000,
        message: 'pick result was never folded back into a model request'
      })
      .toMatchObject({ ok: true, timedOut: false, selectedCount: 1 })

    const result = toolResultFor(mock, 'pick') as { elements?: Array<{ id?: string }> }
    expect(result.elements?.[0]?.id).toBe(drawnId)
  })

  test('thumbnail on an empty scene fails cleanly and the run still finishes', async ({ page }) => {
    const { mock, fixture, scenario } = await openCanvasWithChat(page, 'canvas-thumbnail-empty')
    await enableReasoningActivity(page)
    // No seeding: the canvas starts empty.

    await sendCanvasMessage(page, promptText(scenario, 0))

    await expect
      .poll(() => toolResultFor(mock, 'thumbnail'), {
        timeout: 30_000,
        message: 'the failed thumbnail result was never folded back into a model request'
      })
      .toEqual(expect.stringContaining('thumbnail: nothing to export'))

    const panel = await expandTimeline(page)
    await expect(panel.getByText(/thumbnail failed/)).toBeVisible()
    await expect(panel).toContainText('nothing to export')

    // The error folds back as a role:'tool' turn, satisfying the ReAct stop
    // condition — the run finishes instead of hanging or burning its budget.
    // The fragment is derived from the fixture's captured synthesis, never
    // hardcoded model prose.
    await expect(page.getByText(finalAnswerFragment(fixture))).toBeVisible({ timeout: 30_000 })
  })
})
