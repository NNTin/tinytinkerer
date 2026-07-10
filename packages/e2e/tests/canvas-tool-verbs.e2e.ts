import { test, expect, type Locator, type Page } from '@playwright/test'
import { CANVAS_FRAME, drawViaVerb, minimizeChat, readSnapshot } from '../fixtures/canvas'
import { openCanvasWithChat, sendCanvasMessage } from '../fixtures/canvas-chat'
import {
  enableReasoningActivity,
  scriptedToolCall,
  toolResultFor,
  SYNTHESIS_ANSWER
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
// openCanvasWithChat, backed by mock-litellm.ts's 'scripted' mode): the edge
// worker, the bridge, the sandboxed Excalidraw iframe, the tool registry, and
// the media pipeline are all real. The scripted tool-call arguments below are
// taken verbatim from REAL inference traffic captured against a live PR preview
// — these tests replay actual model behaviour, not an invented shape.

test.use({ viewport: { width: 1280, height: 800 } })

const RED_RECT = {
  id: 'red-rect',
  type: 'rectangle',
  x: 80,
  y: 100,
  width: 180,
  height: 120,
  strokeColor: '#c92a2a',
  backgroundColor: 'transparent'
}
const BLUE_ELLIPSE = {
  id: 'blue-ellipse',
  type: 'ellipse',
  x: 320,
  y: 100,
  width: 180,
  height: 120,
  strokeColor: '#1c7ed6',
  backgroundColor: 'transparent'
}
// A FILLED shape for the interactive-pick test: Excalidraw only hit-tests a
// transparent-background shape (like RED_RECT above) on its stroke outline, not
// its interior, so a click at its bounding-box center would miss. A solid fill
// makes the whole interior clickable, which is all this test needs — it never
// asserts on styling.
const CLICKABLE_RECT = {
  id: 'clickable-rect',
  type: 'rectangle',
  x: 80,
  y: 100,
  width: 180,
  height: 120,
  strokeColor: '#c92a2a',
  backgroundColor: '#ffc9c9'
}

// The per-turn panel auto-collapses when the run finishes; expand it so the
// tool activity entry is queryable. Idempotent: only clicks when collapsed.
// Mirrors the identical helper in react-timeline.e2e.ts / code-exec-activity.e2e.ts.
const expandTimeline = async (page: Page): Promise<Locator> => {
  const toggle = page.getByRole('button', { name: 'Toggle reasoning and activity' }).last()
  await toggle.waitFor({ state: 'visible', timeout: 30_000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return page.locator('section', { has: page.getByText('Reasoning & activity') }).last()
}

test.describe('canvas tool verbs: preview / thumbnail / pick', () => {
  test('thumbnail: folds back as a media handle (no base64) and resolves in the activity panel + transcript', async ({
    page
  }) => {
    const mock = await openCanvasWithChat(
      page,
      [scriptedToolCall('thumbnail', { maxDimension: 512, background: true })],
      '![Canvas snapshot]({{mediaRef}})'
    )
    await enableReasoningActivity(page)
    // The floating chat widget (the canvas's default composer shell) renders
    // the Reasoning & Activity panel directly — this is the regression test
    // for the bug where it didn't.
    await drawViaVerb(page, [RED_RECT, BLUE_ELLIPSE], { replace: true })

    await sendCanvasMessage(page, 'Take a thumbnail of the canvas.')

    await expect
      .poll(() => toolResultFor(mock, 'thumbnail'), {
        timeout: 30_000,
        message: 'thumbnail result was never folded back into a model request'
      })
      .toMatchObject({ ok: true, elementCount: 2, missingIds: [] })

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

    // Media-registry round-trip: the synthesized answer's `{{mediaRef}}` resolves
    // through the UI's media registry back to a real data URL in the transcript.
    const figure = page.locator('figure[data-tt-image]').first()
    await expect(figure).toBeVisible({ timeout: 30_000 })
    await expect(figure.locator('img')).toHaveAttribute('src', /^data:/)
  })

  test('preview is a dry-run: proposes a change, renders it, and commits nothing', async ({
    page
  }) => {
    const mock = await openCanvasWithChat(page, [
      scriptedToolCall('preview', {
        verb: 'draw',
        input: {
          elements: [
            {
              type: 'diamond',
              x: 400,
              y: 200,
              width: 140,
              height: 100,
              strokeColor: 'green',
              backgroundColor: 'transparent'
            }
          ]
        },
        render: true,
        maxDimension: 512
      })
    ])
    await enableReasoningActivity(page)
    await drawViaVerb(page, [RED_RECT], { replace: true })

    await sendCanvasMessage(page, 'Preview drawing a green diamond without applying it.')

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

    // The core safety guarantee: the dry-run committed NOTHING to the real scene.
    // Anchor on the run's final answer first: readSnapshot reads the harness's
    // persisted snapshot, written on a debounced (600ms) `onChange`, so a read
    // taken right after the fold-back could still see the pre-commit snapshot
    // and pass vacuously. By the time the synthesized answer renders (two more
    // model round-trips later), a wrongful commit's debounced write would have
    // landed — the check below can then only pass if nothing was committed.
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => (await readSnapshot(page))?.elements?.length, { timeout: 10_000 })
      .toBe(1)

    const panel = await expandTimeline(page)
    await expect(panel.getByText('Using preview')).toBeVisible()
    await panel.getByText('preview', { exact: true }).click()
    await expect(panel.locator('img[src^="data:image/png"]')).toBeVisible()
  })

  test('pick current + fields projection: a real in-iframe selection round-trips with only the requested keys', async ({
    page
  }) => {
    const mock = await openCanvasWithChat(page, [
      scriptedToolCall('pick', {
        mode: 'current',
        detail: 'standard',
        fields: ['x', 'y', 'width', 'height']
      })
    ])
    await drawViaVerb(page, [RED_RECT, BLUE_ELLIPSE], { replace: true })

    // A real user selection, driven inside the sandboxed iframe: click the
    // canvas (to focus it) then select-all.
    const frame = page.frameLocator(CANVAS_FRAME)
    await frame
      .locator('.excalidraw__canvas')
      .first()
      .click({ position: { x: 20, y: 20 }, force: true })
    await page.keyboard.press('Control+a')

    await sendCanvasMessage(page, 'What elements are currently selected?')

    await expect
      .poll(() => toolResultFor(mock, 'pick'), {
        timeout: 30_000,
        message: 'pick result was never folded back into a model request'
      })
      .toMatchObject({ ok: true, mode: 'current', selectedCount: 2 })

    const result = toolResultFor(mock, 'pick') as { elements?: Array<Record<string, unknown>> }
    expect(result.elements).toHaveLength(2)
    for (const element of result.elements ?? []) {
      // Identity (id/type/kind) is always included; the projection narrows
      // everything else to exactly the requested fields (issue d37380b) — no
      // unrequested key (e.g. `style`, `version`) survives.
      expect(Object.keys(element).sort()).toEqual([
        'height',
        'id',
        'kind',
        'type',
        'width',
        'x',
        'y'
      ])
    }
  })

  test('pick interactive: the in-iframe toast blocks the run, then a real click resolves it', async ({
    page
  }) => {
    const mock = await openCanvasWithChat(page, [
      scriptedToolCall('pick', { mode: 'interactive', prompt: 'Click the shape to inspect.' })
    ])
    await enableReasoningActivity(page)
    await drawViaVerb(page, [CLICKABLE_RECT], { replace: true })

    await sendCanvasMessage(page, 'Ask me to pick a shape, then describe it.')

    const toast = page.frameLocator(CANVAS_FRAME).locator('.Toast__message')
    await expect(toast).toBeVisible({ timeout: 30_000 })
    await expect(toast).toContainText('Click the shape to inspect.')

    // Genuinely blocking: the pick has not resolved while only the toast shows.
    expect(toolResultFor(mock, 'pick')).toBeUndefined()

    // Collapse the floating chat so it stops overlaying the canvas, then click
    // the seeded element for real (a real pointer click, not a bridge call).
    // `draw` scrolls-to-fit its new content (excalidraw-app/src/create.ts's
    // `scrollToContent`), which for one shape well within the viewport centers
    // it at zoom 100% — so the iframe's own center, not the element's scene
    // x/y, is where it lands on screen.
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
    expect(result.elements?.[0]?.id).toBe(CLICKABLE_RECT.id)
  })

  test('thumbnail on an empty scene fails cleanly and the run still finishes', async ({ page }) => {
    const mock = await openCanvasWithChat(page, [scriptedToolCall('thumbnail', {})])
    await enableReasoningActivity(page)
    // No seeding: the canvas starts empty.

    await sendCanvasMessage(page, 'Take a thumbnail of the canvas.')

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
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })
  })
})
