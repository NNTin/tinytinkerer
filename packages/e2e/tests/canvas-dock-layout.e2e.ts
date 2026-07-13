import { test, expect, type Locator } from '@playwright/test'
import { openCanvas } from '../fixtures/canvas'

// Real-browser coverage for the integrated two-panel canvas workspace: both stage and
// assistant remain usable while the shared dock layout resizes and swaps them.
test.use({ viewport: { width: 1280, height: 800 } })

const panelWidth = async (panel: Locator): Promise<number> => {
  const box = await panel.boundingBox()
  if (!box) throw new Error('workspace panel has no bounding box')
  return box.width
}

test.describe('canvas dock layout', () => {
  test('resizes and swaps the directly mounted canvas and assistant panels', async ({ page }) => {
    const { canvas } = await openCanvas(page)
    const canvasPanel = page.locator('.app-dock-panel[data-panel-id="canvas"]')
    const assistantPanel = page.locator('.app-dock-panel[data-panel-id="assistant"]')
    await expect(canvas).toBeVisible()
    await expect(assistantPanel).toBeVisible()

    const initialWidth = await panelWidth(canvasPanel)
    expect(initialWidth).toBeGreaterThan(700)

    const separator = page.getByRole('separator', { name: 'Resize workspace 1' })
    const separatorBox = await separator.boundingBox()
    if (!separatorBox) throw new Error('workspace separator not found')
    await page.mouse.move(
      separatorBox.x + separatorBox.width / 2,
      separatorBox.y + separatorBox.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(separatorBox.x - 150, separatorBox.y, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => panelWidth(canvasPanel)).toBeLessThan(initialWidth)

    const resizedWidth = await panelWidth(canvasPanel)
    await separator.press('ArrowRight')
    await separator.press('ArrowRight')
    await expect.poll(() => panelWidth(canvasPanel)).toBeGreaterThan(resizedWidth)

    const assistantBefore = await assistantPanel.boundingBox()
    await page.getByRole('combobox', { name: 'Move Canvas' }).selectOption('assistant')
    await expect(page.locator('.app-dock-canvas')).toHaveAttribute('data-layout', 'custom')
    const canvasAfter = await canvasPanel.boundingBox()
    const assistantAfter = await assistantPanel.boundingBox()
    expect(assistantBefore).not.toBeNull()
    expect(canvasAfter).not.toBeNull()
    expect(assistantAfter).not.toBeNull()
    expect(canvasAfter!.x).toBeGreaterThan(assistantAfter!.x)
  })
})
