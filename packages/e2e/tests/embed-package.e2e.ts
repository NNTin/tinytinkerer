import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import {
  installAppToolMock,
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

declare global {
  interface Window {
    __embedToolCalls?: unknown[]
  }
}
