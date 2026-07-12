import { expect, test, type Page } from '@playwright/test'
import { dismissFirstLoad, requireShellPort } from '../fixtures/first-load'

const IDE_URL = `http://localhost:${requireShellPort('E2E_PORT')}/ide/`

test.use({ viewport: { width: 1280, height: 800 } })

const openIde = async (page: Page): Promise<void> => {
  await page.goto(IDE_URL)
  await dismissFirstLoad(page)
  await expect(page.getByRole('main', { name: 'TinyTinkerer IDE' })).toBeVisible()
}

const file = (page: Page, path: string) =>
  page.locator(`[data-ide-tree-kind="file"][data-path="${path}"]`)

test.describe('IDE history controls', () => {
  test('undoes and redoes a workspace change with accessible icon buttons', async ({ page }) => {
    await openIde(page)

    const undo = page.getByRole('button', { name: 'Undo agent change' })
    const redo = page.getByRole('button', { name: 'Redo agent change' })
    await expect(undo).toBeDisabled()
    await expect(redo).toBeDisabled()
    await expect(undo).toHaveText('↶')
    await expect(redo).toHaveText('↷')

    page.once('dialog', (dialog) => void dialog.accept('/RenamedApp.tsx'))
    await page.getByTitle('Rename active file').click()
    await expect(file(page, '/RenamedApp.tsx')).toBeVisible()
    await expect(undo).toBeEnabled()

    await undo.click()
    await expect(file(page, '/App.tsx')).toBeVisible()
    await expect(file(page, '/RenamedApp.tsx')).toHaveCount(0)
    await expect(redo).toBeEnabled()

    await redo.click()
    await expect(file(page, '/RenamedApp.tsx')).toBeVisible()
    await expect(file(page, '/App.tsx')).toHaveCount(0)
    await expect(redo).toBeDisabled()
  })

  test('exposes the browser-storage details from the IDE title tooltip', async ({ page }) => {
    await openIde(page)

    await expect(page.getByText('TinyTinkerer IDE', { exact: true })).toHaveAttribute(
      'title',
      'Browser-first · IndexedDB only'
    )
  })
})
