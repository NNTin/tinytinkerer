import { expect, test } from '@playwright/test'
import { dismissFirstLoad, requireShellPort } from '../fixtures/first-load'
import { installChatMock } from '../fixtures/mock-litellm'

const MERMAID_URL = `http://localhost:${requireShellPort('E2E_PORT')}/mermaid/`

test.use({ viewport: { width: 1280, height: 800 } })

test('edits, previews, diagnoses, and rearranges the Mermaid workspace', async ({ page }) => {
  await installChatMock(page)
  await page.goto(MERMAID_URL)
  await dismissFirstLoad(page)

  await expect(page.getByRole('main', { name: 'TinyTinkerer Mermaid' })).toBeVisible()
  await expect(page.getByLabel('Mermaid diagram')).toBeVisible()
  await expect(page.getByText('Create a flowchart for a user sign-up process.')).toBeVisible()

  const editor = page.getByLabel('Mermaid source editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText('flowchart TD\n  A -->')
  await expect(page.getByRole('alert')).toContainText('Mermaid syntax error')
  await expect(page.getByRole('button', { name: 'Ask assistant to fix' })).toBeVisible()

  await page.getByLabel('Layout').selectOption('c')
  await expect(page.locator('.app-dock-canvas')).toHaveAttribute('data-layout', 'c')

  await page
    .locator('[data-panel-drag-handle="preview"]')
    .dragTo(page.locator('[data-panel-id="assistant"]'))
  await expect(page.getByLabel('Layout')).toHaveValue('custom')
  await expect(page.locator('.app-dock-canvas')).toHaveAttribute('data-layout', 'custom')
  const previewBox = await page.locator('[data-panel-id="preview"]').boundingBox()
  const assistantBox = await page.locator('[data-panel-id="assistant"]').boundingBox()
  expect(previewBox?.x ?? 0).toBeGreaterThan(assistantBox?.x ?? 0)

  const separator = page.getByRole('separator', { name: 'Resize workspace 1' })
  const before = Number(await separator.getAttribute('aria-valuenow'))
  await separator.press('ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', String(before + 2))
})
