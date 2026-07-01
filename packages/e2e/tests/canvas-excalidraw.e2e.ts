import { test, expect, type FrameLocator, type Page } from '@playwright/test'
import {
  CANVAS_FRAME,
  CANVAS_URL,
  LIBRARY_CHANNEL,
  LIBRARY_FILE,
  SNAPSHOT_KEY,
  dismissFirstLoad,
  drawRectangle,
  minimizeChat,
  openCanvas,
  postLibraryMessage,
  readSnapshot,
  waitForCanvasReady
} from '../fixtures/canvas'

// Real-browser coverage of the fundamental Excalidraw canvas features fixed in #317:
// the sandboxed iframe's export (downloads), popups (libraries browser), and clipboard
// capabilities, the same-origin library-import relay, and scene persistence across a
// reload. These features cannot run in the jsdom unit tests — they need a real download
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
  frame: FrameLocator,
  label: string,
  extension: RegExp
): Promise<void> => {
  await frame.locator('[data-testid="main-menu-trigger"]').click()
  await frame.locator('[data-testid="image-export-button"]').click()
  const dialog = frame.locator('.ImageExportModal')
  await expect(dialog).toBeVisible()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: label }).click()
  expect((await download).suggestedFilename()).toMatch(extension)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
}

test.describe('canvas Excalidraw features (#317)', () => {
  test('sandboxes the iframe with exactly the capabilities its features need', async ({ page }) => {
    await openCanvas(page)
    const iframe = page.locator(CANVAS_FRAME)
    const sandbox = await iframe.getAttribute('sandbox')
    // Downloads (export), popups + escape (external links), but deliberately NOT
    // allow-same-origin — that would collapse the opaque origin and defeat isolation.
    expect(sandbox).toBe(
      'allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox'
    )
    expect(sandbox ?? '').not.toContain('allow-same-origin')
    // Permissions Policy delegation for the Clipboard API (copy/paste).
    expect(await iframe.getAttribute('allow')).toBe('clipboard-write; clipboard-read')
  })

  test('exports the scene as a PNG and an SVG download', async ({ page }) => {
    const { frame, box } = await openCanvas(page)
    // Draw a shape so there is real content to export (empty scenes can't be exported).
    await drawRectangle(page, frame, box)
    // The export dialog is centred; collapse the chat so it doesn't overlay the buttons.
    await minimizeChat(page)
    await exportImage(page, frame, 'Export to PNG', /\.png$/)
    await exportImage(page, frame, 'Export to SVG', /\.svg$/)
  })

  test('opens the Excalidraw libraries browser in a popup', async ({ page, context }) => {
    const { frame } = await openCanvas(page)
    // Stub the external library site so the popup loads instantly and hermetically.
    await context.route(
      (url) => url.host.endsWith('libraries.excalidraw.com'),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>stub</title>'
        })
    )
    await frame.locator('[title="Library"]').first().click()
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      frame.locator('a.library-menu-browse-button').click()
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

    // The relay fetched the library and forwarded it into the iframe via updateLibrary,
    // which opens the library sidebar and adds the item.
    const panel = page.frameLocator(CANVAS_FRAME).locator('[data-testid="library"]')
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
    const { frame, box } = await openCanvas(page)
    await page.evaluate((key) => localStorage.removeItem(key), SNAPSHOT_KEY)

    await drawRectangle(page, frame, box)
    await expect.poll(() => sceneElementCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)

    await page.reload()
    await dismissFirstLoad(page, 4_000)
    await waitForCanvasReady(page)

    // The harness replayed the persisted snapshot into the iframe on reload. Had restore
    // produced an empty scene, the reloaded iframe's own onChange would have overwritten
    // the snapshot back to zero elements.
    await expect.poll(() => sceneElementCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
  })
})
