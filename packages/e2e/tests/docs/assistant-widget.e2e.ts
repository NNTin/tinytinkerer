import { test, expect, type Page } from '@playwright/test'
import { requireShellPort } from '../../fixtures/first-load'
import { installChatMock } from '../../fixtures/mock-litellm'
import { PIXEL_AGENTS_LAB_URL } from '../../fixtures/docs-lab'

// The floating documentation assistant on the BUILT site (issue #480).
//
// These are the assertions only a real build can make: that the launcher is in
// the statically-generated HTML of every kind of `/docs/` route, that the fixed
// overlay adds no page height and intercepts no clicks, and that the runtime
// chunk is fetched when a reader asks for it rather than on page load.
//
// The model is mocked (`installChatMock`) so opening the assistant consumes no
// quota; nothing here sends a prompt.
const DOCS_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}`

// One of each route kind #480 names. The 404 is covered separately below,
// because an unknown path is not a route this origin can serve — see there.
const ROUTES = {
  landing: `${DOCS_ORIGIN}/docs/`,
  authored: `${DOCS_ORIGIN}/docs/architecture/`,
  nested: `${DOCS_ORIGIN}/docs/plugins-and-tools/build-a-plugin/`,
  search: `${DOCS_ORIGIN}/docs/search/`
} as const

const launcher = (page: Page) => page.getByRole('button', { name: /documentation assistant/i })
const assistantRoot = (page: Page) => page.locator('.docs-assistant-root')

test.describe('the documentation assistant widget (#480)', () => {
  for (const [label, url] of Object.entries(ROUTES)) {
    test(`the launcher is present on the ${label} route`, async ({ page }) => {
      await page.goto(url)
      await expect(launcher(page)).toBeVisible()
    })
  }

  test('the launcher is present on the 404 page', async ({ page }) => {
    // The built 404 document by name, rather than by visiting an unknown path.
    // Both this suite's origin (`vite preview` over a static `apps/host/dist`)
    // and the real deployment (static output, no rewrite rules in vercel.json)
    // answer an unknown `/docs/*` path from the file system, so a reader who
    // follows a broken documentation link gets a full load of exactly this
    // document — not a client-side transition into Docusaurus' NotFound route.
    await page.goto(`${DOCS_ORIGIN}/docs/404.html`)

    await expect(page.getByText('Page Not Found')).toBeVisible()
    await expect(launcher(page)).toBeVisible()
  })

  test('the launcher is in the static HTML, before any JavaScript runs', async ({ browser }) => {
    // A reader on a slow connection should not watch the launcher pop in after
    // hydration — the host renders it during static rendering too.
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(ROUTES.authored)
    await expect(launcher(page)).toBeVisible()
    await context.close()
  })

  test('is not added to pages outside the documentation application', async ({ page }) => {
    // The product's own shells are served from the same origin and never mount
    // @theme/Root, so they must carry none of this.
    await page.goto(`${DOCS_ORIGIN}/web/`)
    await expect(assistantRoot(page)).toHaveCount(0)
  })

  test('adds no page height and intercepts no clicks', async ({ page }) => {
    await page.goto(ROUTES.authored)
    await expect(launcher(page)).toBeVisible()

    // The overlay is `position: fixed`, so the document is exactly as tall as
    // the documentation itself.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - document.body.scrollHeight
    )
    expect(overflow).toBeLessThanOrEqual(0)

    // A point well away from the launcher must hit the page, not the overlay.
    const hit = await page.evaluate(() => {
      const element = document.elementFromPoint(20, Math.round(window.innerHeight / 2))
      return element?.closest('.docs-assistant-root') !== null
    })
    expect(hit).toBe(false)
  })

  test('does not download the runtime until a reader asks for it', async ({ page }) => {
    const chunkRequests: string[] = []
    page.on('request', (request) => {
      if (/assets\/js\//.test(request.url())) chunkRequests.push(request.url())
    })

    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await expect(launcher(page)).toBeVisible()
    const beforeOpen = chunkRequests.length

    await launcher(page).click()
    // The panel is the real ChatApp: its composer is the proof the session
    // mounted, not merely that a chunk was requested.
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
    expect(chunkRequests.length).toBeGreaterThan(beforeOpen)
  })

  test('keeps the conversation and the composer draft across SPA navigation', async ({ page }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()

    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 30_000 })
    await composer.fill('a question I have not sent yet')

    await page
      .locator('.theme-doc-sidebar-container')
      .getByRole('link', { name: 'Contributing' })
      .first()
      .click()
    await expect(page).toHaveURL(/\/docs\/contributing\//)

    // Same mounted widget, same draft: the host is a sibling of the page subtree
    // and Docusaurus never tears it down.
    await expect(composer).toHaveValue('a question I have not sent yet')
  })

  test('offers current-page suggestions on a document and none on search', async ({ page }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Summarize this page.' })).toBeVisible()

    await page.goto(ROUTES.search)
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
    // Nothing may imply a current document exists where there is none.
    await expect(page.getByRole('button', { name: 'Summarize this page.' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'How can I host TinyTinkerer?' })).toBeVisible()
  })

  test('remembers a minimized panel, and downloads no runtime on the next load', async ({
    page
  }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Minimize widget' }).click()
    await expect(page.getByRole('button', { name: 'Restore widget' })).toBeVisible()

    await page.reload()
    // Back to the light launcher, and the panel is not restored.
    await expect(launcher(page)).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0)
  })

  test('remembers an open panel across a reload', async ({ page }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })

    await page.reload()
    // Restoring the reader's own choice, runtime download included.
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
  })

  test('hides entirely while a fullscreen lab owns the viewport', async ({ page }) => {
    await installChatMock(page)
    await page.goto(PIXEL_AGENTS_LAB_URL)
    await expect(launcher(page)).toBeVisible()

    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click()
    await expect(assistantRoot(page)).toHaveAttribute('data-host-overlay', 'true')
    await expect(launcher(page)).toBeHidden()

    await page.getByRole('button', { name: 'Exit fullscreen' }).click()
    await expect(launcher(page)).toBeVisible()
  })

  test('hides while the mobile navigation drawer is open', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 })
    await page.goto(ROUTES.authored)
    await expect(launcher(page)).toBeVisible()

    await page.getByRole('button', { name: 'Toggle navigation bar' }).click()
    await expect(page.locator('.navbar-sidebar')).toBeVisible()
    await expect(launcher(page)).toBeHidden()
  })

  test('stays usable in dark mode', async ({ page }) => {
    // Driven from the system preference rather than by clicking the navbar
    // toggle: `colorMode.respectPrefersColorScheme` is true for this site, so
    // this lands on dark deterministically. Clicking a toggle only *flips*
    // whatever the runner's own preference produced, which is how this test
    // first arrived at light and asserted dark.
    await page.emulateMedia({ colorScheme: 'dark' })
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    // The site's own dark mode must survive the assistant's stylesheet, which
    // opens with `:root { color-scheme: light }` (issue #479's containment) —
    // and the widget must not stay a bright panel on a dark page.
    await launcher(page).click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    const panelBrightness = await page.evaluate(() => {
      const shell = document.querySelector('.docs-assistant-root .widget-floating-shell')
      if (!shell) return null
      const { backgroundColor } = getComputedStyle(shell)
      const parts = (backgroundColor.match(/[\d.]+/g) ?? []).map(Number)
      // Chromium reports a `color-mix()` result as `color(srgb r g b / a)` with
      // 0–1 components, and a plain colour as `rgb()`/`rgba()` with 0–255 ones.
      // Reading the first form as if it were the second is how this assertion
      // first concluded a genuinely dark panel was light.
      const scale = backgroundColor.startsWith('color(') ? 255 : 1
      const [r = 1, g = 1, b = 1] = parts
      return ((r + g + b) / 3) * scale
    })
    expect(panelBrightness).not.toBeNull()
    expect(panelBrightness!).toBeLessThan(128)
  })

  test('the launcher and panel controls are keyboard operable', async ({ page }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)

    await launcher(page).focus()
    await expect(launcher(page)).toBeFocused()
    await page.keyboard.press('Enter')

    // Cold activation puts focus where a reader can type.
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 30_000 })
    await expect(composer).toBeFocused()

    // Minimizing returns focus to the launcher that replaced the panel.
    await page.getByRole('button', { name: 'Minimize widget' }).click()
    const restore = page.getByRole('button', { name: 'Restore widget' })
    await expect(restore).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(composer).toBeFocused()
  })
})
