import { test, expect, type Page } from '@playwright/test'
import {
  SNAPSHOT_KEY,
  drawViaVerb,
  openCanvas,
  readSnapshot,
  type SnapshotElement
} from '../fixtures/canvas'

// Regression for the line-alignment bug (tin-73): a `draw` verb line with width:0
// (a vertical spine) was stored with points [0,0]->[100,h] instead of [0,0]->[0,h].
// convertToExcalidrawElements derives a linear element's endpoint from
// `element.width || DEFAULT_LINEAR(=100)`, so a legitimate width:0 was mistaken for
// "missing" and defaulted to 100 — the spine veered right and detached from every
// limb anchored to its x. This can ONLY reproduce in the real browser bundle: the
// jsdom unit tests mock convertToExcalidrawElements away. The fix (create.ts emits
// explicit points for linear elements) is verified end-to-end here.
//
// Note on the reported soccer input: the draw schema requires width/height to be
// nonnegative, so the report's negative-width left arms/legs are rejected before they
// reach this code — the only schema-valid trigger is the width:0 vertical body line,
// which is exactly what we assert below.

test.use({ viewport: { width: 1280, height: 800 } })

// A half stick figure per player using only schema-valid (nonnegative) deltas: a head,
// a vertical body (width:0 — the bug trigger), and a right arm + right leg as controls
// whose nonzero widths were never affected. Two players + a ball, mirroring the report.
const soccerScene = (): Record<string, unknown>[] => {
  const player = (trunkX: number): Record<string, unknown>[] => [
    { type: 'ellipse', x: trunkX - 25, y: 100, width: 50, height: 50 },
    { type: 'line', x: trunkX, y: 150, width: 0, height: 70 }, // body / spine — width:0
    { type: 'line', x: trunkX, y: 170, width: 30, height: 30 }, // right arm (control)
    { type: 'line', x: trunkX, y: 220, width: 25, height: 40 } // right leg (control)
  ]
  return [
    ...player(125),
    ...player(325),
    { type: 'ellipse', x: 220, y: 240, width: 30, height: 30 } // ball
  ]
}

const lineElements = (elements: SnapshotElement[] | undefined): SnapshotElement[] =>
  (elements ?? []).filter((element) => element.type === 'line')

// Wait for the harness to persist the verb-drawn scene into its snapshot, then return
// the line elements so their stored points can be inspected.
const readLines = async (page: Page): Promise<SnapshotElement[]> => {
  await expect
    .poll(async () => lineElements((await readSnapshot(page))?.elements).length, {
      timeout: 10_000
    })
    .toBeGreaterThanOrEqual(4)
  return lineElements((await readSnapshot(page))?.elements)
}

test.describe('canvas line alignment (tin-73)', () => {
  test('a width:0 line is stored as a vertical spine, not a rightward diagonal', async ({
    page
  }) => {
    await openCanvas(page)
    // Start from an empty canvas so element counts and geometry are deterministic.
    await page.evaluate((key) => localStorage.removeItem(key), SNAPSHOT_KEY)

    const result = await drawViaVerb(page, soccerScene(), { replace: true })
    expect(result.ok).toBe(true)

    const lines = await readLines(page)

    // Spines: the two body lines have a vertical delta of 70. Each must drop straight
    // down — endpoint x delta 0 — and keep a zero-width bounding box. Pre-fix these
    // were points[1] === [100, 70] (the DEFAULT_LINEAR width leaking in).
    const spines = lines.filter((line) => line.points?.[1]?.[1] === 70)
    expect(spines).toHaveLength(2)
    for (const spine of spines) {
      expect(spine.points?.[0]).toEqual([0, 0])
      expect(spine.points?.[1]).toEqual([0, 70])
      expect(spine.width).toBe(0)
      expect(spine.height).toBe(70)
    }

    // Controls: the nonzero-width arms/legs were never affected — their points must
    // still match the input delta exactly (30x30 arms, 25x40 legs).
    const arms = lines.filter((line) => line.points?.[1]?.[1] === 30)
    expect(arms).toHaveLength(2)
    for (const arm of arms) expect(arm.points?.[1]).toEqual([30, 30])
    const legs = lines.filter((line) => line.points?.[1]?.[1] === 40)
    expect(legs).toHaveLength(2)
    for (const leg of legs) expect(leg.points?.[1]).toEqual([25, 40])

    // The visible artifact: with the fix the spines render vertical and the figures
    // read as stick people; pre-fix they veered right and detached from the limbs.
    await page.locator('iframe.app-harness-frame').screenshot({
      path: test.info().outputPath('line-alignment.png')
    })
  })
})
