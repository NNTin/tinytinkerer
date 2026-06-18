import { test, expect, type Page } from '@playwright/test'
import {
  installLiteLLMMock,
  enableCodeExecPlugin,
  runSnippetViaChat,
  type LiteLLMMock
} from '../fixtures/mock-litellm'
import * as snippets from '../fixtures/snippets'

// Real-browser verification of the code-exec sandbox isolation guarantees that
// jsdom cannot cover (GitHub issue #217). LiteLLM is mocked: a fixture streams a
// tool call so the REAL frontend agent auto-invokes `run_javascript` with an
// adversarial snippet, in anonymous mode with no edge/network. Each guarantee uses
// a DUAL ORACLE — the in-sandbox result the runtime folds back into the next
// model request (mock.allText()) AND an independent Playwright observation
// (no sentinel request reached the network / the sandbox iframe was torn down).
// See docs/e2e-testing.md.

const SANDBOX_IFRAME = 'iframe[title="code execution sandbox"]'

// Collect any *successful response* from the sentinel host — i.e. real egress.
// Chromium still fires a `request` event for a CSP-blocked attempt (it registers
// the request, then blocks it), so a request alone is not egress; only a returned
// `response` means data actually left and came back. CSP / API-absence yields no
// response, so this stays empty on success.
const watchSentinelEgress = (page: Page): string[] => {
  const responses: string[] = []
  page.on('response', (response) => {
    if (response.url().includes(snippets.SENTINEL_HOST)) responses.push(response.url())
  })
  return responses
}

const drive = async (page: Page, code: string): Promise<LiteLLMMock> => {
  const mock = await installLiteLLMMock(page, code)
  await page.goto('/web/')
  await enableCodeExecPlugin(page)
  await runSnippetViaChat(page, mock)
  return mock
}

test.describe('code-exec sandbox isolation (#217)', () => {
  test('1. no network egress (connect-src none blocks fetch/XHR/WebSocket/beacon/EventSource)', async ({
    page
  }) => {
    const egress = watchSentinelEgress(page)
    const mock = await drive(page, snippets.NO_EGRESS)
    const text = mock.allText()

    // In-sandbox oracle: every vector was blocked or unavailable, none succeeded.
    expect(text).toContain('"fetch":"blocked')
    expect(text).toContain('"xhr":"blocked')
    expect(text).toContain('"websocket":"blocked')
    expect(text).toContain('"sendBeacon":"blocked')
    expect(text).toContain('"eventSource":"blocked')
    expect(text).not.toContain('NOT_BLOCKED')

    // External oracle: no response ever came back from the sentinel.
    expect(egress).toEqual([])
  })

  test('2. no eval / new Function (no unsafe-eval in CSP)', async ({ page }) => {
    const mock = await drive(page, snippets.NO_EVAL)
    const text = mock.allText()

    expect(text).toContain('"eval":"blocked')
    expect(text).toContain('"newFunction":"blocked')
    expect(text).not.toContain('NOT_BLOCKED')
  })

  test('3. opaque origin (no parent/top DOM, storage, cookies, app URL)', async ({ page }) => {
    const mock = await drive(page, snippets.OPAQUE_ORIGIN)
    const text = mock.allText()

    // None of the storage/DOM surfaces are reachable, and indexedDB cannot open.
    expect(text).toContain('"parent":"unreachable')
    expect(text).toContain('"localStorage":"unreachable')
    expect(text).toContain('"sessionStorage":"unreachable')
    expect(text).toContain('"cookie":"unreachable')
    expect(text).not.toContain('"indexedDB":"OPENED')
    // The worker's location must never leak the embedding app's http(s) origin.
    expect(text).toContain('"locationLeaksAppOrigin":false')
  })

  test('4. no referrer leak (no-referrer; worker has no document.referrer)', async ({ page }) => {
    const egress = watchSentinelEgress(page)
    const mock = await drive(page, snippets.NO_REFERRER)
    const text = mock.allText()

    // In-sandbox: no document surface exists to read a referrer from.
    expect(text).toContain('"hasDocument":false')
    expect(text).toContain('"referrer":"no-document"')
    // External: nothing successfully reached the network.
    expect(egress).toEqual([])
  })

  test('5. no resource loads (img-src/media-src none; importScripts blocked)', async ({ page }) => {
    const egress = watchSentinelEgress(page)
    const mock = await drive(page, snippets.NO_RESOURCE_LOADS)
    const text = mock.allText()

    // Image is unavailable in the worker; importScripts of a remote URL is blocked.
    expect(text).toMatch(/"image":"(unavailable|blocked)/)
    expect(text).toMatch(/"importScripts":"(unavailable|blocked)/)
    expect(text).not.toContain('NOT_BLOCKED')
    expect(egress).toEqual([])
  })

  test('6. worker creation works (worker-src blob: in the sandboxed iframe)', async ({ page }) => {
    const mock = await drive(page, snippets.WORKER_WORKS)
    const text = mock.allText()

    // The benign computation ran and returned, proving the blob: Worker functions.
    expect(text).toContain('"ok":true')
    expect(text).toContain('"sum":2')
    expect(text).toContain('"ran":true')
  })

  test('7. timeout terminates an infinite loop and the iframe is torn down', async ({ page }) => {
    const mock = await drive(page, snippets.INFINITE_LOOP)
    const text = mock.allText()

    // The 10s deadline fired and the run was reported as timed out.
    expect(text).toContain('"timedOut":true')
    // No residual sandbox iframe remains in the page.
    await expect(page.locator(SANDBOX_IFRAME)).toHaveCount(0)
  })
})
