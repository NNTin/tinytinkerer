import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dismissFirstLoad, requireShellPort } from '../fixtures/first-load'
import { installChatMock } from '../fixtures/mock-litellm'

// Real-browser coverage of the Mermaid export controls (#424): the Export… button
// in the Preview panel's toolbar, its modal (format/background/dark-mode/filename
// controls, live preview, and per-format actions), and the actual exported
// artifacts — a real file download for PNG/SVG and a real clipboard write for the
// clipboard format. These are real-browser concerns (download events, Canvas
// rasterization, clipboard permissions) that jsdom unit tests cannot exercise.

const MERMAID_URL = `http://localhost:${requireShellPort('E2E_PORT')}/mermaid/`

test.use({ viewport: { width: 1280, height: 800 } })

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const readDownload = async (download: { path: () => Promise<string | null> }): Promise<Buffer> => {
  const path = await download.path()
  if (!path) throw new Error('download did not save to disk')
  return readFileSync(path)
}

test.describe('Mermaid export controls (#424)', () => {
  test('exports the diagram as SVG honoring background and filename controls', async ({ page }) => {
    await installChatMock(page)
    await page.goto(MERMAID_URL)
    await dismissFirstLoad(page)

    await page.getByRole('button', { name: 'Export…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export diagram' })
    await expect(dialog).toBeVisible()

    await expect(dialog.getByRole('radio', { name: 'PNG', exact: true })).toBeChecked()
    await expect(dialog.getByLabel('Transparent background')).toBeChecked()
    const filenameInput = dialog.getByLabel('Filename')
    await expect(filenameInput).toHaveValue(/^tinytinkerer-\d{4}-\d{2}-\d{2}-\d{6}$/)

    await filenameInput.fill('my/dia:gram v1')
    await dialog.getByRole('radio', { name: 'SVG', exact: true }).check()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Export SVG' }).click()
    ])
    expect(download.suggestedFilename()).toBe('mydiagram v1.svg')

    const svgText = (await readDownload(download)).toString('utf8')
    expect(svgText.startsWith('<svg') || svgText.startsWith('<?xml')).toBe(true)
    expect(svgText).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svgText).not.toContain('tt-export-background')

    await expect(dialog).toBeHidden()
  })

  // Mermaid emits <foreignObject> for HTML labels, and Chromium taints a canvas
  // that draws an SVG-with-foreignObject image loaded from a blob: URL (data:
  // URLs stay untainted — see rasterizeSvgToPng in packages/app/mermaid). This
  // test rasterizes the real default diagram, so it regresses if that data:-URL
  // constraint is ever broken.
  test('exports a solid-background dark PNG at exactly 2x the diagram size, with no preview padding', async ({
    page
  }) => {
    await installChatMock(page)
    await page.goto(MERMAID_URL)
    await dismissFirstLoad(page)

    await page.getByRole('button', { name: 'Export…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export diagram' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Transparent background').uncheck()
    await dialog.getByLabel('Dark mode').check()

    const previewSvg = dialog.locator('.mermaid-export-frame svg')
    await expect(previewSvg).toBeVisible()
    const viewBox = await previewSvg.getAttribute('viewBox')
    if (!viewBox) throw new Error('preview svg has no viewBox')
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    const [, , w, h] = parts
    if (w === undefined || h === undefined) throw new Error('viewBox is missing width/height')
    const expectedWidth = Math.ceil(w) * 2
    const expectedHeight = Math.ceil(h) * 2

    const [pngDownload] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Export PNG' }).click()
    ])
    const pngBytes = await readDownload(pngDownload)
    expect(pngBytes.subarray(0, 8)).toEqual(PNG_SIGNATURE)
    const ihdrWidth = pngBytes.readUInt32BE(16)
    const ihdrHeight = pngBytes.readUInt32BE(20)
    expect(ihdrWidth).toBe(expectedWidth)
    expect(ihdrHeight).toBe(expectedHeight)

    // Reopen and export the same configuration as SVG: the background rect must
    // be present and use the dark-mode solid color.
    await page.getByRole('button', { name: 'Export…' }).click()
    const dialog2 = page.getByRole('dialog', { name: 'Export diagram' })
    await expect(dialog2).toBeVisible()
    await dialog2.getByLabel('Transparent background').uncheck()
    await dialog2.getByLabel('Dark mode').check()
    await dialog2.getByRole('radio', { name: 'SVG', exact: true }).check()

    const [svgDownload] = await Promise.all([
      page.waitForEvent('download'),
      dialog2.getByRole('button', { name: 'Export SVG' }).click()
    ])
    const svgText = (await readDownload(svgDownload)).toString('utf8')
    expect(svgText).toContain('class="tt-export-background"')
    expect(svgText).toContain('fill="#333333"')
  })

  test('copies a PNG to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await installChatMock(page)
    await page.goto(MERMAID_URL)
    await dismissFirstLoad(page)

    await page.getByRole('button', { name: 'Export…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export diagram' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('radio', { name: 'Copy to clipboard (PNG)' }).check()
    await expect(dialog.getByLabel('Filename')).toBeDisabled()

    await dialog.getByRole('button', { name: 'Copy to clipboard' }).click()
    await expect(dialog.getByText('Copied to clipboard.')).toBeVisible()
    await expect(dialog).toBeVisible()

    const clipboardTypes = await page.evaluate(async () => {
      const items = await navigator.clipboard.read()
      return items.flatMap((item) => item.types)
    })
    expect(clipboardTypes).toContain('image/png')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('disables export for an empty workspace and surfaces render errors for invalid source', async ({
    page
  }) => {
    await installChatMock(page)
    await page.goto(MERMAID_URL)
    await dismissFirstLoad(page)

    const exportButton = page.getByRole('button', { name: 'Export…' })
    const editor = page.getByLabel('Mermaid source editor').locator('.cm-content')
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    await expect(exportButton).toBeDisabled()

    await editor.click()
    await page.keyboard.insertText('flowchart TD\n  A -->')
    await expect(exportButton).toBeEnabled()

    await exportButton.click()
    const dialog = page.getByRole('dialog', { name: 'Export diagram' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^Export/ })).toBeDisabled()
  })
})
