import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import {
  installAppToolMock,
  installChatMock,
  sendMessage,
  toolResultFor,
  SYNTHESIS_ANSWER
} from '../fixtures/mock-litellm'
import { requireShellPort } from '../fixtures/first-load'

// Acceptance for the published embed package (issue #510, T1).
//
// The page under test is NOT a workspace app. It is `acceptance/host/` in
// packages/app/embed: a fresh npm project that installed the packed
// @nntin/tinytinkerer-embed tarball from scratch, typechecked against its
// published declarations and built itself with its own Vite
// (`acceptance/run.mjs`, which also asserts the install leaked nothing but
// React). This spec serves that build and completes one chat turn in which the
// model calls the host's single Zod-schema tool — through the REAL edge worker,
// with only LiteLLM mocked, exactly like every other chat spec here.
//
// Served from the composed origin's port under /embed-host/ by request
// interception, so the edge sees the same allowed origin as every other spec
// and the host's same-origin `edgeBaseUrl` reaches `/api/**`.

const HOST_DIST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../app/embed/acceptance/.output/dist'
)
const HOST_PATH = '/embed-host/'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2'
}

const serveAcceptanceHost = async (page: Page, origin: string): Promise<void> => {
  await page.route(`${origin}${HOST_PATH}**`, async (route) => {
    const { pathname } = new URL(route.request().url())
    const relative = pathname.slice(HOST_PATH.length) || 'index.html'
    const file = normalize(join(HOST_DIST, relative))
    if (!file.startsWith(HOST_DIST) || !existsSync(file)) {
      await route.fulfill({ status: 404, body: 'not found' })
      return
    }
    await route.fulfill({
      status: 200,
      headers: { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' },
      body: readFileSync(file)
    })
  })
}

test.describe('embed package acceptance (#510 T1)', () => {
  test.beforeAll(() => {
    if (!existsSync(join(HOST_DIST, 'index.html'))) {
      throw new Error(
        `${HOST_DIST} is missing. Build the package and the acceptance host first:\n` +
          '  pnpm --filter @nntin/tinytinkerer-embed build\n' +
          '  pnpm --filter @nntin/tinytinkerer-embed acceptance'
      )
    }
  })

  test('a fresh npm host renders ChatApp and completes a turn that calls its Zod tool', async ({
    page
  }) => {
    const origin = `http://localhost:${requireShellPort('E2E_PORT')}`
    const toolInput = { board: 'perfboard-70x90' }
    const mock = await installAppToolMock(page, 'measure_board', toolInput)
    await serveAcceptanceHost(page, origin)

    await page.goto(`${origin}${HOST_PATH}`)
    await expect(page.getByRole('heading', { name: 'Embed acceptance host' })).toBeVisible()

    // The chat surface comes from the package, inside the host's own scope.
    const surface = page.locator('.tt-app-embed').first()
    await expect(surface.getByPlaceholder('Ask anything')).toBeVisible()

    // Both stylesheets are loaded now, and the host page is untouched (issue
    // #518, F1): its own `--accent`/`--muted` on :root keep their values, and
    // its root's color-scheme is still its own. The surface follows the host's
    // `--accent` through `theme: { accent: 'var(--accent)' }` — no self-cycle.
    const tokens = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const stage = document.querySelector('.sidebar-stage')
      return {
        accent: root.getPropertyValue('--accent').trim(),
        muted: root.getPropertyValue('--muted').trim(),
        colorScheme: root.colorScheme,
        stageAccent: stage ? getComputedStyle(stage).getPropertyValue('--tt-accent').trim() : null,
        stageMuted: stage ? getComputedStyle(stage).getPropertyValue('--tt-muted').trim() : null
      }
    })
    expect(tokens).toEqual({
      accent: '#bd5839',
      muted: '#4b5563',
      colorScheme: 'normal',
      // `theme.accent` is inline on the stage, so it beats the host's
      // `--tt-accent` on the wrapper...
      stageAccent: '#bd5839',
      // ...while `--tt-muted`, which `theme` leaves alone, is the host's: its
      // wrapper rule beats the package default declared there (issue #523, G5).
      stageMuted: '#6b6b6b'
    })

    await sendMessage(page, 'How big is the perfboard-70x90?')

    // The host's tool ran in the page, with the model's arguments...
    await expect
      .poll(() => page.evaluate(() => window.__embedToolCalls ?? []), {
        timeout: 30_000,
        message: 'the host tool was never executed'
      })
      .toEqual([{ board: 'perfboard-70x90', widthMm: 70, heightMm: 90 }])

    // ...its result went back to the model as a native tool result...
    await expect
      .poll(() => toolResultFor(mock, 'measure_board'), { timeout: 30_000 })
      .toEqual({ board: 'perfboard-70x90', widthMm: 70, heightMm: 90 })

    // ...and the turn finished with the synthesized answer on screen.
    await expect(surface.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })
  })
})

// The built-in floating overlay (issue #523, G3/G4), in the same fresh-npm host:
// `?layout=floating` mounts `<ChatApp mode="floating" overlay>` with the
// package's default size, over a page that has a control of its own.
test.describe('embed package floating overlay (#523 G3/G4)', () => {
  test.beforeAll(() => {
    if (!existsSync(join(HOST_DIST, 'index.html'))) {
      throw new Error(`${HOST_DIST} is missing; see the acceptance suite above.`)
    }
  })

  const openFloating = async (page: Page, viewport: { width: number; height: number }) => {
    const origin = `http://localhost:${requireShellPort('E2E_PORT')}`
    await installChatMock(page)
    await serveAcceptanceHost(page, origin)
    await page.setViewportSize(viewport)
    await page.goto(`${origin}${HOST_PATH}?layout=floating`)
    await expect(page.getByRole('button', { name: 'Minimize widget' })).toBeVisible()
  }

  test('the host page keeps its clicks under the stage; the panel and launcher keep theirs', async ({
    page
  }) => {
    await openFloating(page, { width: 1280, height: 800 })

    // The stage really does cover the whole viewport, the host's button included...
    const stage = page.locator('.widget-stage.widget-stage--overlay')
    expect(await stage.boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 800 })
    const hostButton = page.getByRole('button', { name: /^Host clicks:/ })
    const hostBox = await hostButton.boundingBox()
    if (!hostBox) throw new Error('the host button has no box')
    const panelBox = await page.locator('.widget-floating-shell').boundingBox()
    if (!panelBox) throw new Error('the panel has no box')
    expect(
      hostBox.x + hostBox.width <= panelBox.x || hostBox.y + hostBox.height <= panelBox.y
    ).toBe(true)

    // ...yet the hit test there lands on the host's own control, not the stage.
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.textContent ?? null,
      { x: hostBox.x + hostBox.width / 2, y: hostBox.y + hostBox.height / 2 }
    )
    expect(hit).toBe('Host clicks: 0')
    await hostButton.click()
    await expect(hostButton).toHaveText('Host clicks: 1')

    // The panel is interactive, and so is the launcher that replaces it.
    await page.getByRole('button', { name: 'Minimize widget' }).click()
    await page.getByRole('button', { name: 'Restore widget' }).click()
    await expect(page.getByRole('button', { name: 'Minimize widget' })).toBeVisible()
    await expect(page.getByPlaceholder('Ask anything')).toBeVisible()
  })

  test('the default 400px panel is clamped to a phone viewport', async ({ page }) => {
    await openFloating(page, { width: 360, height: 740 })

    const panelBox = await page.locator('.widget-floating-shell').boundingBox()
    if (!panelBox) throw new Error('the panel has no box')
    expect(panelBox.width).toBeLessThanOrEqual(Math.min(400, 360 - 32))
    expect(panelBox.x).toBeGreaterThanOrEqual(16)
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(360 - 16)
    expect(panelBox.y).toBeGreaterThanOrEqual(0)
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(740)
    // Nothing scrolls sideways either.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  })
})

declare global {
  interface Window {
    __embedToolCalls?: unknown[]
  }
}
