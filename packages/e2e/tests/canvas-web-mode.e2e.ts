import { test, expect, type Locator } from '@playwright/test'
import { CANVAS_FRAME, openCanvas } from '../fixtures/canvas'

// Real-browser coverage of the canvas widget↔web-mode morph (#324): the canvas chat is
// the shared morphable ChatApp, so dragging its floating window to a viewport edge docks
// it into the resizable "web mode" split, and the harness shrinks the Excalidraw iframe
// into the complementary region so the app and chat sit side by side. Dragging back out
// (the float button) restores the full-bleed whiteboard with the widget floating over it.

test.use({ viewport: { width: 1280, height: 800 } })

const frameWidth = async (iframe: Locator): Promise<number> => {
  const box = await iframe.boundingBox()
  if (!box) throw new Error('canvas iframe has no bounding box')
  return box.width
}

test.describe('canvas web mode (#324)', () => {
  test('snap-docking the widget splits the canvas into a resizable web layout', async ({
    page
  }) => {
    const { iframe } = await openCanvas(page)

    // Widget mode: the iframe fills the whole stage.
    expect(await frameWidth(iframe)).toBeGreaterThan(1200)

    // Drag the widget grip to the right edge and release → morph into the docked split.
    const grip = page.getByRole('button', { name: /move widget/i })
    const box = await grip.boundingBox()
    if (!box) throw new Error('drag grip not found')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(1080, box.y + box.height / 2, { steps: 8 })
    await page.mouse.move(1277, box.y + box.height / 2, { steps: 8 })
    await expect(page.locator('.widget-snap-preview')).toBeVisible()
    await page.mouse.up()

    // Web mode: the docked panel + resize handle are present and the iframe shrank into
    // the space the panel leaves (a real split, not an overlay).
    const panel = page.locator('.sidebar-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('data-edge', 'right')
    await expect(page.getByRole('button', { name: 'Resize sidebar' })).toBeVisible()
    await expect.poll(async () => frameWidth(iframe), { timeout: 5_000 }).toBeLessThan(1000)
    const dockedWidth = await frameWidth(iframe)

    // The divider resizes the split: dragging the handle left grows the chat panel, so
    // the iframe shrinks further.
    const handle = page.getByRole('button', { name: 'Resize sidebar' })
    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('resize handle not found')
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x - 150, handleBox.y, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => frameWidth(iframe), { timeout: 5_000 }).toBeLessThan(dockedWidth)

    // Float it again → the iframe fills the stage once more, widget overlaying it.
    await page.getByRole('button', { name: 'Float chat' }).click()
    await expect(page.locator(`${CANVAS_FRAME}`)).toBeVisible()
    await expect.poll(async () => frameWidth(iframe), { timeout: 5_000 }).toBeGreaterThan(1200)
    await expect(page.getByRole('button', { name: 'Dock to sidebar' })).toBeVisible()
  })
})
