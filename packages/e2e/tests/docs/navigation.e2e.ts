import { test, expect } from '@playwright/test'
import { requireShellPort } from '../../fixtures/first-load'

// General /docs site navigation coverage (issue #457): sidebar navigation, deep
// links, refreshed nested routes, local search, responsive layout, keyboard
// flows, and the light/dark theme toggle. These are pure static-content
// concerns — no live lab, no chat mock, no auth needed.
const DOCS_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}`

test.describe('docs navigation (#457)', () => {
  test('sidebar navigation updates the route and heading', async ({ page }) => {
    await page.goto(`${DOCS_ORIGIN}/docs/architecture/`)
    await expect(page.locator('h1').first()).toHaveText('Architecture')

    await page
      .locator('.theme-doc-sidebar-container')
      .getByRole('link', { name: 'Contributing' })
      .click()
    await expect(page).toHaveURL(`${DOCS_ORIGIN}/docs/contributing/`)
    // CONTRIBUTING.md has several top-level `#` headings of its own (Security
    // Issues, Contributor License Terms, ...) — only the page's own first one
    // needs asserting here.
    await expect(page.locator('h1').first()).toHaveText('Contributing')
  })

  test('a deep link loads the target page directly, without visiting the home page first', async ({
    page
  }) => {
    // No prior navigation in this test at all — this IS the first request the
    // browser makes, exercising the statically-generated page for this exact
    // route rather than client-side routing from an already-loaded shell.
    await page.goto(`${DOCS_ORIGIN}/docs/plugins-and-tools/build-a-plugin/`)
    await expect(page.locator('h1').first()).toHaveText('Build a plugin')
    await expect(
      page.locator('.theme-doc-breadcrumbs, nav[aria-label="Breadcrumbs"]')
    ).toContainText('Build a plugin')
  })

  test('a full page refresh on a nested route re-renders the same content', async ({ page }) => {
    await page.goto(`${DOCS_ORIGIN}/docs/self-hosting/vercel-deployment/`)
    await expect(page.locator('h1').first()).toHaveText('Vercel Deployment Guide')

    await page.reload()
    await expect(page.locator('h1').first()).toHaveText('Vercel Deployment Guide')
    await expect(page).toHaveURL(`${DOCS_ORIGIN}/docs/self-hosting/vercel-deployment/`)
  })

  test('local search finds a result and navigates to it', async ({ page }) => {
    await page.goto(`${DOCS_ORIGIN}/docs/`)
    const searchInput = page.locator('input[aria-label="Search"]')
    await searchInput.click()
    await searchInput.fill('Pixel Agents')

    const firstResult = page.getByRole('option').first()
    await expect(firstResult).toBeVisible()
    await firstResult.click()

    // The search-local plugin appends highlight query params and a fragment;
    // only the pathname is this test's concern.
    await expect(page).toHaveURL(/\/docs\/extending\//)
  })

  test('a narrow viewport collapses the sidebar behind a toggle', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 })
    await page.goto(`${DOCS_ORIGIN}/docs/architecture/`)

    const sidebar = page.locator('.navbar-sidebar')
    await expect(sidebar).toBeHidden()

    await page.getByRole('button', { name: 'Toggle navigation bar' }).click()
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Contributing' })).toBeVisible()
  })

  test('the theme toggle switches to dark mode and the choice survives a reload', async ({
    page
  }) => {
    await page.goto(`${DOCS_ORIGIN}/docs/architecture/`)
    const toggle = page.locator('button[aria-label*="Switch between dark and light mode"]')

    // Docusaurus's toggle cycles system -> light -> dark; this environment's
    // "system" already resolves to light, so two clicks are needed to reach an
    // unambiguous, explicitly-chosen dark mode.
    await toggle.click()
    await toggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})
