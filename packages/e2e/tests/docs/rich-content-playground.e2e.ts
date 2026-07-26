import { test, expect } from '@playwright/test'
import { RICH_CONTENT_PLAYGROUND_URL } from '../../fixtures/docs-lab'

// The rich content playground (docs/extending/rich-content-playground.mdx,
// apps/docs/src/playground/) has no LiveLab/LiveSessionGate/backend session at
// all — pure client-side markdown parse/render, no network mock needed.
test.describe('docs rich content playground (#455)', () => {
  test('typing markdown updates the preview and the AST disclosure', async ({ page }) => {
    await page.goto(RICH_CONTENT_PLAYGROUND_URL)

    const source = page.locator('#rich-content-playground-source')
    await source.fill('# Hello playground')

    await expect(
      page.locator('.rich-content-playground__preview').getByRole('heading', { level: 1 })
    ).toHaveText('Hello playground')

    await page.locator('.rich-content-playground__ast summary').click()
    await expect(page.locator('.rich-content-playground__ast-list')).toContainText('heading')
  })

  test('Example select swaps source and preview, Reset reverts, Copy source works', async ({
    page,
    context
  }) => {
    await context.grantPermissions(['clipboard-write'])
    await page.goto(RICH_CONTENT_PLAYGROUND_URL)

    const source = page.locator('#rich-content-playground-source')
    const initialSource = await source.inputValue()

    // Not getByLabel('Example'): this doc page's own prose contains a
    // "## Sharing an example" heading, and Docusaurus's auto-generated anchor
    // link on it (aria-label="Direct link to Sharing an example") also matches
    // a substring "Example" label lookup.
    const exampleSelect = page.locator('.rich-content-playground__toolbar select')
    const options = await exampleSelect.locator('option').allTextContents()
    expect(options.length).toBeGreaterThan(1)
    await exampleSelect.selectOption({ index: 1 })

    await expect
      .poll(() => source.inputValue(), {
        message: 'expected selecting a different example to change the source textarea'
      })
      .not.toBe(initialSource)
    const selectedExampleSource = await source.inputValue()

    await source.fill('some edited text')
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(source).toHaveValue(selectedExampleSource)

    await page.getByRole('button', { name: 'Copy source' }).click()
    await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible()
  })
})
