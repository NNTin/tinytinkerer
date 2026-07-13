import { test, expect, type Page } from '@playwright/test'
import {
  CANVAS_URL,
  canvasStage,
  readSnapshot,
  waitForCanvasReady,
  type SnapshotElement
} from '../fixtures/canvas'
import { sendCanvasMessage } from '../fixtures/canvas-chat'
import { dismissFirstLoad } from '../fixtures/first-load'
import { installAppToolMock, toolResultFor, type LiteLLMMock } from '../fixtures/mock-litellm'

// Regression for tin-73: convertToExcalidrawElements must preserve a legitimate zero
// width for vertical lines instead of substituting its default linear width.
test.use({ viewport: { width: 1280, height: 800 } })

const soccerScene = (): Record<string, unknown>[] => {
  const player = (trunkX: number): Record<string, unknown>[] => [
    { type: 'ellipse', x: trunkX - 25, y: 100, width: 50, height: 50 },
    { type: 'line', x: trunkX, y: 150, width: 0, height: 70 },
    { type: 'line', x: trunkX, y: 170, width: 30, height: 30 },
    { type: 'line', x: trunkX, y: 220, width: 25, height: 40 }
  ]
  return [
    ...player(125),
    ...player(325),
    { type: 'ellipse', x: 220, y: 240, width: 30, height: 30 }
  ]
}

const lineElements = (elements: SnapshotElement[] | undefined): SnapshotElement[] =>
  (elements ?? []).filter((element) => element.type === 'line')

const readLines = async (page: Page): Promise<SnapshotElement[]> => {
  await expect
    .poll(async () => lineElements((await readSnapshot(page))?.elements).length, {
      timeout: 10_000
    })
    .toBeGreaterThanOrEqual(4)
  return lineElements((await readSnapshot(page))?.elements)
}

const waitForDraw = async (mock: LiteLLMMock): Promise<void> => {
  await expect
    .poll(() => toolResultFor(mock, 'draw'), { timeout: 30_000 })
    .toMatchObject({ ok: true })
}

test.describe('canvas line alignment (tin-73)', () => {
  test('a width:0 line is stored as a vertical spine, not a diagonal', async ({ page }) => {
    const input = { elements: soccerScene(), connectors: [], replace: true }
    const mock = await installAppToolMock(page, 'draw', input)
    await page.goto(CANVAS_URL)
    await dismissFirstLoad(page)
    await waitForCanvasReady(page)
    await sendCanvasMessage(page, 'Draw the two-player soccer scene.')
    await waitForDraw(mock)

    const lines = await readLines(page)
    const spines = lines.filter((line) => line.points?.[1]?.[1] === 70)
    expect(spines).toHaveLength(2)
    for (const spine of spines) {
      expect(spine.points?.[0]).toEqual([0, 0])
      expect(spine.points?.[1]).toEqual([0, 70])
      expect(spine.width).toBe(0)
      expect(spine.height).toBe(70)
    }

    const arms = lines.filter((line) => line.points?.[1]?.[1] === 30)
    expect(arms).toHaveLength(2)
    for (const arm of arms) expect(arm.points?.[1]).toEqual([30, 30])
    const legs = lines.filter((line) => line.points?.[1]?.[1] === 40)
    expect(legs).toHaveLength(2)
    for (const leg of legs) expect(leg.points?.[1]).toEqual([25, 40])

    await canvasStage(page).screenshot({ path: test.info().outputPath('line-alignment.png') })
  })
})
