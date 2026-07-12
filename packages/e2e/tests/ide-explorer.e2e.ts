import { expect, test, type Page } from '@playwright/test'
import { dismissFirstLoad, requireShellPort } from '../fixtures/first-load'

const IDE_URL = `http://localhost:${requireShellPort('E2E_PORT')}/ide/`

test.use({ viewport: { width: 1280, height: 800 } })

const openIde = async (page: Page): Promise<void> => {
  await page.goto(IDE_URL)
  await dismissFirstLoad(page)
  await expect(page.getByRole('main', { name: 'TinyTinkerer IDE' })).toBeVisible()
}

const directory = (page: Page, path: string) =>
  page.locator(`[data-ide-tree-kind="directory"][data-path="${path}"]`)

const file = (page: Page, path: string) =>
  page.locator(`[data-ide-tree-kind="file"][data-path="${path}"]`)

test.describe('IDE Explorer', () => {
  test('renders directory rows and lets users collapse their children', async ({ page }) => {
    await openIde(page)

    const publicDirectory = directory(page, '/public')
    const indexFile = file(page, '/public/index.html')
    await expect(publicDirectory).toBeVisible()
    await expect(publicDirectory).toHaveText(/public/)
    await expect(publicDirectory).toHaveAttribute('aria-expanded', 'true')
    await expect(indexFile).toBeVisible()

    await publicDirectory.click()
    await expect(publicDirectory).toHaveAttribute('aria-expanded', 'false')
    await expect(indexFile).toBeHidden()

    await publicDirectory.click()
    await expect(publicDirectory).toHaveAttribute('aria-expanded', 'true')
    await expect(indexFile).toBeVisible()
  })

  test('keeps matching files and their parent folders visible while filtering', async ({
    page
  }) => {
    await openIde(page)

    const publicDirectory = directory(page, '/public')
    await publicDirectory.click()
    await expect(publicDirectory).toHaveAttribute('aria-expanded', 'false')

    await page.getByRole('textbox', { name: 'Search files' }).fill('index.html')
    await expect(publicDirectory).toHaveAttribute('aria-expanded', 'true')
    await expect(file(page, '/public/index.html')).toBeVisible()
    await expect(file(page, '/App.tsx')).toBeHidden()

    await page.getByRole('textbox', { name: 'Search files' }).clear()
    await expect(publicDirectory).toHaveAttribute('aria-expanded', 'false')
  })

  test('creates folder rows for a new file in a nested path', async ({ page }) => {
    await openIde(page)

    page.once('dialog', (dialog) => {
      void dialog.accept('/src/components/Button.tsx')
    })
    await page.getByTitle('New file').click()

    await expect(directory(page, '/src')).toBeVisible()
    await expect(directory(page, '/src/components')).toBeVisible()
    await expect(file(page, '/src/components/Button.tsx')).toBeVisible()
    await expect(file(page, '/src/components/Button.tsx')).toHaveClass(/active/)
  })
})
