import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  CANVAS_URL,
  LIBRARY_CHANNEL,
  LIBRARY_FILE,
  drawRectangle,
  openCanvas,
  postLibraryMessage,
  readSnapshot,
  waitForCanvasReady
} from '../fixtures/canvas'
import { dismissFirstLoad } from '../fixtures/first-load'

// Real-browser coverage of the fundamental Excalidraw canvas features fixed in #317:
// the integrated Excalidraw stage's downloads, popups, library relay, and IndexedDB
// persistence across a reload. These features cannot run in the jsdom unit tests — they need a real download
// event, a real popup, a real BroadcastChannel, and a real reload.

test.use({ viewport: { width: 1280, height: 800 } })

const libraryItemCount = async (page: Page): Promise<number> =>
  (await readSnapshot(page))?.libraryItems?.length ?? 0

const sceneElementCount = async (page: Page): Promise<number> =>
  (await readSnapshot(page))?.elements?.length ?? 0

// Open the main menu → Export image dialog, click one format, and assert a real file
// download fires. Closes the dialog afterwards so a second export starts clean.
const exportImage = async (
  page: Page,
  canvas: Locator,
  label: string,
  extension: RegExp
): Promise<void> => {
  await canvas.locator('[data-testid="main-menu-trigger"]').click()
  await canvas.locator('[data-testid="image-export-button"]').click()
  // Excalidraw portals dialogs to the document root, outside the dock panel.
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Export image' }) })
  await expect(dialog).toBeVisible()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: label }).click()
  expect((await download).suggestedFilename()).toMatch(extension)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
}

test.describe('canvas Excalidraw features (#317)', () => {
  test('mounts Excalidraw directly beside the assistant without an app iframe', async ({
    page
  }) => {
    const { canvas } = await openCanvas(page)
    await expect(canvas.locator('.excalidraw')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Assistant' })).toBeVisible()
    await expect(canvas.locator('iframe')).toHaveCount(0)
  })

  test('exports the scene as a PNG and an SVG download', async ({ page }) => {
    const { canvas, box } = await openCanvas(page)
    // Draw a shape so there is real content to export (empty scenes can't be exported).
    await drawRectangle(page, canvas, box)
    await expect.poll(() => sceneElementCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
    await exportImage(page, canvas, 'Export to PNG', /\.png$/)
    await exportImage(page, canvas, 'Export to SVG', /\.svg$/)
  })

  test('opens the Excalidraw libraries browser in a popup', async ({ page, context }) => {
    const { canvas } = await openCanvas(page)
    // Stub the external library site so the popup loads instantly and hermetically.
    await context.route(
      (url) => url.host === 'libraries.excalidraw.com',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>stub</title>'
        })
    )
    await canvas.locator('[title="Library"]').first().click()
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      canvas.locator('a.library-menu-browse-button').click()
    ])
    await popup.waitForLoadState('domcontentloaded').catch(() => undefined)
    expect(new URL(popup.url()).host).toBe('libraries.excalidraw.com')
    await popup.close()
  })

  test('imports a library through the same-origin relay', async ({ page }) => {
    const libraryUrl = 'https://libraries.excalidraw.com/e2e-test.excalidrawlib'
    await openCanvas(page)
    let fetched = false
    await page.route(libraryUrl, (route) => {
      fetched = true
      return route.fulfill({ status: 200, contentType: 'application/json', body: LIBRARY_FILE })
    })

    await postLibraryMessage(page, { libraryUrl, idToken: 'tok' })

    // The relay fetched the library and applied it to the in-process Excalidraw API.
    const panel = page.locator('[data-testid="library"]')
    await expect(panel.locator('.library-unit__dragger').first()).toBeVisible({ timeout: 15_000 })
    expect(fetched).toBe(true)
    // And onLibraryChange persisted the imported library into the scene snapshot.
    await expect.poll(() => libraryItemCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
  })

  test('the library-callback page relays the URL over the BroadcastChannel', async ({
    context
  }) => {
    const callback = await context.newPage()
    await callback.addInitScript((channel) => {
      const store = window as unknown as { __received: unknown }
      store.__received = null
      new BroadcastChannel(channel).onmessage = (event) => {
        store.__received = event.data
      }
      // Keep the relay tab open so the test can read what it delivered.
      window.close = () => {}
    }, LIBRARY_CHANNEL)

    const libraryUrl = 'https://libraries.excalidraw.com/cb-test.excalidrawlib'
    await callback.goto(
      `${CANVAS_URL}library-callback/#addLibrary=${encodeURIComponent(libraryUrl)}&token=tok`
    )
    await callback.waitForFunction(
      () => (window as unknown as { __received: unknown }).__received !== null,
      { timeout: 5_000 }
    )
    const received = await callback.evaluate(
      () =>
        (window as unknown as { __received: { libraryUrl?: string; idToken?: string } | null })
          .__received
    )
    expect(received).toMatchObject({ libraryUrl, idToken: 'tok' })
    await expect(callback.locator('#status')).toContainText('Library sent')
    await callback.close()
  })

  test('rejects a library URL from a non-excalidraw.com host', async ({ page }) => {
    const evilUrl = 'https://evil.example.com/x.excalidrawlib'
    await openCanvas(page)
    let fetched = false
    await page.route(evilUrl, (route) => {
      fetched = true
      return route.fulfill({ status: 200, body: '{}' })
    })

    await postLibraryMessage(page, { libraryUrl: evilUrl, idToken: 'tok' })
    await page.waitForTimeout(1_000)

    // The allow-list rejects the host before any fetch, so nothing is imported.
    expect(fetched).toBe(false)
    expect(await libraryItemCount(page)).toBe(0)
  })

  test('restores the scene after a full page reload', async ({ page }) => {
    const { canvas, box } = await openCanvas(page)
    await drawRectangle(page, canvas, box)
    await expect.poll(() => sceneElementCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)

    await page.reload()
    await dismissFirstLoad(page, 4_000)
    await waitForCanvasReady(page)

    // The integrated stage loaded its IndexedDB snapshot as Excalidraw initial data.
    await expect.poll(() => sceneElementCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
  })
})
