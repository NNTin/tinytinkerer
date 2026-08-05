import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { dismissTelemetryDialog, requireShellPort } from '../../fixtures/first-load'
import {
  installAppToolMock,
  installChatMock,
  SYNTHESIS_ANSWER,
  toolResultFor
} from '../../fixtures/mock-litellm'
import { PIXEL_AGENTS_LAB_URL } from '../../fixtures/docs-lab'
import { sendAssistantPrompt } from '../../fixtures/docs-assistant'
import { AA_NORMAL_TEXT, worstContrastIn } from '../../fixtures/contrast'

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
  search: `${DOCS_ORIGIN}/docs/search/`,
  // The site's real unlisted document (`docs/updates/PRIVACY-UPDATE.md`,
  // `unlisted: true`). Excluded from global search, still routed, and a current
  // document when visited directly — so the launcher belongs here too (#481).
  unlisted: `${DOCS_ORIGIN}/docs/updates/PRIVACY-UPDATE/`
} as const

const launcher = (page: Page) => page.getByRole('button', { name: /documentation assistant/i })
const assistantRoot = (page: Page) => page.locator('.docs-assistant-root')
const assistantInset = (page: Page, edge: 'top' | 'right' | 'bottom' | 'left' = 'right') =>
  page.evaluate((physicalEdge) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(
      `--docs-assistant-inset-${physicalEdge}`
    )
    return Number.parseFloat(value)
  }, edge)

test.describe('the documentation assistant widget (#480)', () => {
  for (const [label, url] of Object.entries(ROUTES)) {
    test(`the launcher is present on the ${label} route`, async ({ page }) => {
      await page.goto(url)
      await expect(launcher(page)).toBeVisible()
    })
  }

  test('the launcher is present on a genuinely missing docs URL', async ({ page }) => {
    // An actually nonexistent path, not the 404 artifact by filename. Asserting
    // the file proved only that the build emits it — it could not see that the
    // deployment answered a broken documentation link with its own plain-text
    // NOT_FOUND, so no reader ever reached this page (issue #480 review).
    //
    // The routing that makes this work is vercel.json's `/docs(/.*)?` route,
    // mirrored for this origin by apps/host/vite.config.ts's preview middleware.
    const response = await page.goto(`${DOCS_ORIGIN}/docs/definitely-missing-review-route`)

    // The Docusaurus 404 body AND a 404 status (issue #480 re-review, finding 6):
    // a soft 404 would tell crawlers, caches and monitoring that a missing
    // document exists.
    expect(response?.status()).toBe(404)
    await expect(page.getByText('Page Not Found')).toBeVisible()
    await expect(launcher(page)).toBeVisible()
  })

  test('the missing-docs fallback does not leak outside /docs/', async ({ page }) => {
    // The route is scoped: an unknown path at the root keeps whatever the host
    // already did, and must never start answering with the documentation's 404.
    const response = await page.goto(`${DOCS_ORIGIN}/definitely-missing-root-route`)

    expect(await response?.text()).not.toContain('docs-assistant-launcher')
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

  test('offers the Documentation tools in the normal tool picker', async ({ page }) => {
    // The acceptance criterion #477 deferred and #479 claimed: the three tools
    // are visible in the ordinary picker and independently controllable. The
    // unit test that stood in for it supplied the summarizer itself, so the real
    // widget shipped with no picker button at all.
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
    // The assistant owns the documentation site's telemetry consent (issue
    // #479), so activating it for the first time opens that dialog over the
    // page. Every pointer interaction below is behind it until it is answered.
    await dismissTelemetryDialog(page)

    await page.getByRole('button', { name: 'Choose available tools' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose available tools' })
    await expect(picker).toBeVisible()
    await expect(picker).toContainText('Documentation')

    const searchDocs = picker.getByRole('checkbox', { name: 'search_docs' })
    await expect(searchDocs).toBeChecked()
    await expect(picker.getByRole('checkbox', { name: 'read_doc' })).toBeChecked()
    await expect(picker.getByRole('checkbox', { name: 'read_current_doc' })).toBeChecked()

    // Independently controllable: one off, the others untouched. `click()` plus a
    // retrying assertion rather than `uncheck()`, whose one-shot state check
    // races the store's async persist-then-rerender.
    await searchDocs.click()
    await expect(searchDocs).not.toBeChecked()
    await expect(picker.getByRole('checkbox', { name: 'read_doc' })).toBeChecked()
    await expect(picker.getByRole('checkbox', { name: 'read_current_doc' })).toBeChecked()

    // …and the choice survives a reload, through the assistant's own store.
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Choose available tools' }).click()
    await expect(
      page
        .getByRole('dialog', { name: 'Choose available tools' })
        .getByRole('checkbox', { name: 'search_docs' })
    ).not.toBeChecked()
  })

  test('answers about the page the run started on, even after navigating mid-run', async ({
    page
  }) => {
    // The locked criterion the draft test replaced with an unsent draft: a
    // response/tool call in flight must survive navigation. Keeping the React
    // node mounted is only half of it — `read_current_doc` resolves at EXECUTION
    // time, so without a run pin the reader gets an answer about wherever they
    // drifted to (issue #480 review, finding 5).
    const mock = await installAppToolMock(page, 'read_current_doc', {})
    // Hold the model's first response back so the tool call is issued well after
    // the navigation below, making this a fact about the pin rather than a race.
    // Registered after the mock, so it intercepts first and falls through.
    await page.route('**/api/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      await route.fallback()
    })

    await page.goto(ROUTES.authored)
    await launcher(page).click()
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)

    // Answers #481's pre-send disclosure on the way through: it stands in front
    // of every first send in a fresh context, and this spec is about the run pin,
    // not the gate.
    await sendAssistantPrompt(page, 'Summarize this page.')

    // Leave for a different document while the run is still in flight.
    await page
      .locator('.theme-doc-sidebar-container')
      .getByRole('link', { name: 'Contributing' })
      .first()
      .click()
    await expect(page).toHaveURL(/\/docs\/contributing\//)

    // The same run completes on the new route…
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    // …and its tool result is still about the page the question was asked on.
    const result = toolResultFor(mock, 'read_current_doc') as
      | { status?: string; doc?: { ref?: string } }
      | undefined
    expect(result?.status).toBe('ok')
    expect(result?.doc?.ref).toBe('architecture/ARCHITECTURE')
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

  // === Morphing into the docked web mode (issue #480 re-review, finding 2) ===

  test('docks into the sidebar, insets the page, and comes back', async ({ page }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 30_000 })
    // Its overlay is `fixed inset-0` and intercepts every pointer event on the
    // page, including the dock button.
    await dismissTelemetryDialog(page)

    const article = page.locator('article').first()
    const floatingBox = await article.boundingBox()

    await page.getByRole('button', { name: 'Dock to sidebar' }).click()
    const panel = page.locator('.docs-assistant-stage .sidebar-panel')
    await expect(panel).toBeVisible()
    // The conversation surface came with it; only the layout wrapper swapped.
    await expect(composer).toBeVisible()

    // The page is INSET, not covered: the article's right edge stops before the
    // panel starts, the way AppStageShell insets /ide's stage.
    const panelBox = await panel.boundingBox()
    const dockedBox = await article.boundingBox()
    expect(panelBox).not.toBeNull()
    expect(dockedBox).not.toBeNull()
    expect(dockedBox!.x + dockedBox!.width).toBeLessThanOrEqual(panelBox!.x + 1)
    expect(dockedBox!.width).toBeLessThan(floatingBox!.width)

    await page.getByRole('button', { name: 'Float chat' }).click()
    await expect(panel).toHaveCount(0)
    await expect(composer).toBeVisible()
    // The inset is released, so the page is back to its full width. Polled
    // because the padding is transitioned — a single measurement would catch it
    // mid-animation.
    await expect
      .poll(async () => Math.round((await article.boundingBox())!.width))
      .toBe(Math.round(floatingBox!.width))
  })

  test('restores a docked assistant across a reload', async ({ page }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)
    await page.getByRole('button', { name: 'Dock to sidebar' }).click()
    await expect(page.locator('.docs-assistant-stage .sidebar-panel')).toBeVisible()

    await page.reload()

    // One versioned record covers mode AND open/minimized, so the reader gets
    // back exactly what they left — not a floating widget that re-docks a frame
    // later, and not a launcher.
    await expect(page.locator('.docs-assistant-stage .sidebar-panel')).toBeVisible({
      timeout: 30_000
    })
    await expect(launcher(page)).toHaveCount(0)
  })

  test('persists a snap edge in the one host-owned presentation record', async ({ page }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)

    // Use the drag-to-snap path rather than the ordinary dock button: only a snap
    // carries a non-default edge, which is what exposed ChatApp's former private
    // presentation record.
    const grip = page.getByRole('button', { name: /move widget/i })
    const box = await grip.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(2, box!.y + box!.height / 2, { steps: 12 })
    await page.mouse.up()

    const panel = page.locator('.docs-assistant-stage .sidebar-panel')
    await expect(panel).toHaveAttribute('data-edge', 'left')

    const records = await page.evaluate(() => ({
      host: window.localStorage.getItem('tinytinkerer:docs-assistant-presentation:presentation'),
      chatApp: window.localStorage.getItem('tinytinkerer:docs-assistant-layout:v1:presentation')
    }))
    expect(JSON.parse(records.host ?? '{}')).toMatchObject({
      mode: 'sidebar',
      minimized: false,
      edge: 'left'
    })
    expect(records.chatApp).toBeNull()

    await page.reload()
    await expect(panel).toHaveAttribute('data-edge', 'left', { timeout: 30_000 })
  })

  test('releases a docked page inset while search owns the viewport, then restores it', async ({
    page
  }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)
    await page.getByRole('button', { name: 'Dock to sidebar' }).click()

    const article = page.locator('article').first()
    const panel = page.locator('.docs-assistant-stage .sidebar-panel')
    await expect(panel).toBeVisible()
    await expect.poll(() => assistantInset(page)).toBeGreaterThan(0)
    const dockedInset = await assistantInset(page)
    const dockedWidth = (await article.boundingBox())!.width

    await page.keyboard.press('Control+K')
    await expect(assistantRoot(page)).toHaveAttribute('data-host-overlay', 'true')
    await expect(panel).toBeHidden()
    await expect.poll(() => assistantInset(page)).toBe(0)
    await expect
      .poll(async () => Math.round((await article.boundingBox())!.width))
      .toBeGreaterThan(Math.round(dockedWidth))
    const searchWidth = (await article.boundingBox())!.width
    expect(searchWidth).toBeGreaterThan(dockedWidth)

    await page.keyboard.press('Escape')
    await expect(assistantRoot(page)).toHaveAttribute('data-host-overlay', 'false')
    await expect(panel).toBeVisible()
    // Assert the actual coordinator output rather than pixel-equality with the
    // first animation frame of the page's 120ms padding transition.
    await expect.poll(() => assistantInset(page)).toBe(dockedInset)
    await expect
      .poll(async () => Math.round((await article.boundingBox())!.width))
      .toBeLessThan(Math.round(searchWidth))
  })

  test('keeps a docked assistant, and its draft, across SPA navigation', async ({ page }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)
    await page.getByRole('button', { name: 'Dock to sidebar' }).click()
    await composer.fill('a draft that must survive docking and navigating')

    await page
      .locator('.theme-doc-sidebar-container')
      .getByRole('link', { name: 'Contributing' })
      .first()
      .click()
    await expect(page).toHaveURL(/\/docs\/contributing\//)

    await expect(page.locator('.docs-assistant-stage .sidebar-panel')).toBeVisible()
    await expect(composer).toHaveValue('a draft that must survive docking and navigating')
  })

  test('a docked assistant hides with the rest while a host overlay owns the viewport', async ({
    page
  }) => {
    // The overlay contract is per-ROOT, not per-layout: the docked panel is
    // inside the same `.docs-assistant-root` the `inert`/visibility rules key on,
    // so docking cannot leak a surface past a fullscreen lab.
    await installChatMock(page)
    await page.goto(PIXEL_AGENTS_LAB_URL)
    await launcher(page).click()
    // Scoped to the assistant: this lab embeds a ChatApp of its own, so a bare
    // composer locator matches two.
    await expect(assistantRoot(page).getByRole('textbox', { name: 'Message' })).toBeVisible({
      timeout: 30_000
    })
    await dismissTelemetryDialog(page)
    await assistantRoot(page).getByRole('button', { name: 'Dock to sidebar' }).click()
    const panel = page.locator('.docs-assistant-stage .sidebar-panel')
    await expect(panel).toBeVisible()
    await expect.poll(() => assistantInset(page)).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click()
    await expect(assistantRoot(page)).toHaveAttribute('data-host-overlay', 'true')
    await expect(panel).toBeHidden()
    await expect.poll(() => assistantInset(page)).toBe(0)

    await page.getByRole('button', { name: 'Exit fullscreen' }).click()
    await expect(panel).toBeVisible()
    await expect.poll(() => assistantInset(page)).toBeGreaterThan(0)
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
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    await expect(assistantRoot(page).getByRole('textbox', { name: 'Message' })).toBeVisible({
      timeout: 30_000
    })
    await dismissTelemetryDialog(page)
    await assistantRoot(page).getByRole('button', { name: 'Dock to sidebar' }).click()
    await expect.poll(() => assistantInset(page)).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Toggle navigation bar' }).click()
    await expect(page.locator('.navbar-sidebar')).toBeVisible()
    await expect(assistantRoot(page)).toHaveAttribute('data-host-overlay', 'true')
    await expect.poll(() => assistantInset(page)).toBe(0)

    await page.getByRole('button', { name: 'Close navigation bar' }).click()
    await expect(assistantRoot(page)).toHaveAttribute('data-host-overlay', 'false')
    await expect.poll(() => assistantInset(page)).toBeGreaterThan(0)
  })

  // The dialogs below were measured at 1.04:1, 1.63:1 and 2.19:1 in dark mode
  // before the shared primitives moved onto semantic tokens (issue #480 review,
  // finding 3). `worstContrastIn` moved to `fixtures/contrast.ts` when #496
  // needed the same sweep over a live lab — see `docs/lab-theming.e2e.ts`.
  for (const theme of ['light', 'dark'] as const) {
    test(`the consent, privacy and settings surfaces are legible in ${theme} mode`, async ({
      page
    }) => {
      await page.emulateMedia({ colorScheme: theme })
      await installChatMock(page)
      await page.goto(ROUTES.authored)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      // Consent is the FIRST thing a reader sees after activating the assistant,
      // and it was the least legible surface of all.
      await launcher(page).click()
      const consent = page.getByRole('dialog', { name: 'Telemetry' })
      await expect(consent).toBeVisible({ timeout: 30_000 })
      expect(await worstContrastIn(page, '[aria-label="Telemetry"]')).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT
      )

      // The privacy policy it links to.
      await consent.getByRole('button', { name: 'Learn more' }).click()
      const privacy = page.getByRole('dialog', { name: 'Privacy & Telemetry' })
      await expect(privacy).toBeVisible()
      expect(
        await worstContrastIn(page, '[aria-label="Privacy & Telemetry"]')
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
      await privacy.getByRole('button', { name: 'Close privacy policy' }).first().click()
      await dismissTelemetryDialog(page)

      // The settings panel, whose heading and tabs were the other reported case.
      await page.getByRole('button', { name: 'Settings' }).click()
      const settings = page.locator('[data-presentation="inline"][aria-label="Settings"]')
      await expect(settings).toBeVisible()
      expect(
        await worstContrastIn(page, '[data-presentation="inline"][aria-label="Settings"]')
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)

      // …and the tool picker, the last embedded surface with its own chrome.
      await page.getByRole('button', { name: 'Close settings' }).first().click()
      await page.getByRole('button', { name: 'Choose available tools' }).click()
      await expect(page.getByRole('dialog', { name: 'Choose available tools' })).toBeVisible()
      expect(
        await worstContrastIn(page, '[aria-label="Choose available tools"]')
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)

      // axe over the whole assistant subtree, which catches what a contrast
      // sweep cannot (names, roles, control labelling) on the same surfaces.
      const results = await new AxeBuilder({ page }).include('.docs-assistant-root').analyze()
      const serious = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical'
      )
      expect(JSON.stringify(serious, null, 2)).toBe('[]')
    })
  }

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

  // === The pre-send privacy disclosure (issue #481) ===========================

  test('discloses what a send does before the first one, and sends nothing until acknowledged', async ({
    page
  }) => {
    const mock = await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)

    await composer.fill('Summarize this page.')
    await composer.press('Enter')

    const disclosure = page.getByRole('dialog', { name: 'Before you send this' })
    await expect(disclosure).toBeVisible()
    // The claim a reader is most likely to want checked, and the one the whole
    // corpus design exists to make true.
    await expect(disclosure).toContainText('only when it uses one of its documentation tools')

    // The guarantee: nothing reached the model. Asserted against the mocked
    // upstream's recorded request bodies, not against a spinner.
    expect(mock.requestBodies()).toHaveLength(0)

    // Dismissing keeps the reader's question — it is not a cancellation.
    await disclosure.getByRole('button', { name: 'Not now' }).click()
    await expect(disclosure).toBeHidden()
    await expect(composer).toHaveValue('Summarize this page.')
    expect(mock.requestBodies()).toHaveLength(0)

    // Acknowledging completes the send the reader already asked for.
    await composer.press('Enter')
    await expect(disclosure).toBeVisible()
    await disclosure.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })
    await expect(composer).toHaveValue('')
  })

  test('asks once per reader, not once per message', async ({ page }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)
    await sendAssistantPrompt(page, 'First question.')
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    // The acknowledgement is persisted in the assistant's own namespace, so it
    // survives a reload — a disclosure that reappeared every session would train
    // readers to click past it.
    await page.reload()
    await expect(composer).toBeVisible({ timeout: 30_000 })
    await composer.fill('Second question.')
    await composer.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Before you send this' })).toHaveCount(0)
    await expect(composer).toHaveValue('')
  })

  test('Regenerate cannot send a persisted conversation past the disclosure', async ({ page }) => {
    // The bypass this gate was missing (issue #481 review, finding 1). Regenerate
    // reaches `sendPrompt` directly, so a reader with history and no
    // acknowledgement could re-send the whole conversation without ever seeing
    // the dialog.
    //
    // Built by producing real history first, then revoking the acknowledgement —
    // which is what a returning reader looks like after the disclosure's version
    // is bumped, and the only way to reach this state through the real product.
    const mock = await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)
    await sendAssistantPrompt(page, 'A question with an answer.')
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

    await page.evaluate(
      ([database, key]) =>
        new Promise<void>((resolve, reject) => {
          // IndexedDB reports failures as `DOMException | null`; the lint rule
          // (rightly) wants a real Error either way.
          const fail = (reason: DOMException | null) =>
            reject(reason instanceof Error ? reason : new Error('IndexedDB request failed'))
          const request = indexedDB.open(database)
          request.onerror = () => fail(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('preferences', 'readwrite')
            tx.objectStore('preferences').delete(key)
            tx.oncomplete = () => {
              db.close()
              resolve()
            }
            tx.onerror = () => fail(tx.error)
          }
        }),
      ['tinytinkerer-docs-assistant', 'pre_send_disclosure_acknowledged_version'] as const
    )

    await page.reload()
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })
    const sendsBefore = mock.requestBodies().length

    await page.getByRole('button', { name: 'Regenerate response' }).click()

    // The gate stands in front of Regenerate exactly as it does in front of the
    // composer, and nothing reached the model while it did.
    const disclosure = page.getByRole('dialog', { name: 'Before you send this' })
    await expect(disclosure).toBeVisible()
    expect(mock.requestBodies()).toHaveLength(sendsBefore)

    await disclosure.getByRole('button', { name: 'Send' }).click()
    await expect(disclosure).toBeHidden()
    // …and once acknowledged the regenerate it was holding actually runs.
    await expect.poll(() => mock.requestBodies().length).toBeGreaterThan(sendsBefore)
  })

  test('reading the privacy policy from the disclosure keeps the message intact', async ({
    page
  }) => {
    // Two aria-modal dialogs, stacked (issue #481 review, finding 2). One Escape
    // used to close both — taking the unsent message with it.
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)

    await composer.fill('A question I still want to ask.')
    await composer.press('Enter')
    const disclosure = page.getByRole('dialog', { name: 'Before you send this' })
    await expect(disclosure).toBeVisible()

    await disclosure.getByRole('button', { name: 'Read the privacy policy' }).click()
    const policy = page.getByRole('dialog', { name: 'Privacy & Telemetry' })
    await expect(policy).toBeVisible()
    // The disclosure steps aside completely rather than competing for the
    // keyboard: `inert` removes it from the pointer, the tab order, and the
    // accessibility tree.
    await expect(disclosure).toHaveAttribute('inert', '')
    expect(await policy.evaluate((node) => node.contains(document.activeElement))).toBe(true)

    await page.keyboard.press('Escape')

    // Only the policy closed. The disclosure is live again, and the reader's
    // message is exactly where they left it.
    await expect(policy).toHaveCount(0)
    await expect(disclosure).toBeVisible()
    await expect(disclosure).not.toHaveAttribute('inert', '')
    await disclosure.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })
    await expect(composer).toHaveValue('')
  })

  test('keeps the disclosure available in Settings after it has been acknowledged', async ({
    page
  }) => {
    await installChatMock(page)
    await page.goto(ROUTES.authored)
    await launcher(page).click()
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 30_000 })
    await dismissTelemetryDialog(page)
    await sendAssistantPrompt(page, 'A question.')

    // A disclosure a reader sees exactly once, while trying to do something
    // else, is not one they can return to.
    await page.getByRole('button', { name: 'Settings' }).click()
    const settings = page.locator('[data-presentation="inline"][aria-label="Settings"]')
    await expect(settings).toBeVisible()
    await settings.getByRole('tab', { name: 'Privacy' }).click()
    await expect(settings).toContainText('Before you send this')
    await expect(settings).toContainText('only when it uses one of its documentation tools')
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
