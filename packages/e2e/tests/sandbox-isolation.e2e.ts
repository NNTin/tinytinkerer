import { test, expect, type Page } from '@playwright/test'
import {
  installLiteLLMMock,
  enableCodeExecPlugin,
  runSnippetViaChat,
  type LiteLLMMock
} from '../fixtures/mock-litellm'
import * as snippets from '../fixtures/snippets'

// Real-browser verification of the code-exec sandbox isolation guarantees that
// jsdom cannot cover (GitHub issue #217). Only LiteLLM is mocked: a fixture streams
// a tool call (through the real edge worker) so the agent auto-invokes
// `run_javascript` with an adversarial snippet, anonymously. Each guarantee uses a
// DUAL ORACLE — the in-sandbox result the runtime folds back into the next model
// request (parsed via `mock.sandboxResult()`) AND an independent Playwright
// observation (a 200-fulfilling sentinel route that only fires on real egress, or
// the sandbox iframe being torn down). See packages/e2e/README.md.

const SANDBOX_IFRAME = 'iframe[title="code execution sandbox"]'

const drive = async (page: Page, code: string): Promise<LiteLLMMock> => {
  const mock = await installLiteLLMMock(page, code)
  await page.goto('/web/')
  await enableCodeExecPlugin(page)
  await runSnippetViaChat(page, mock)
  return mock
}

// The structured object the adversarial snippet returned, surfaced from the parsed
// SandboxExecutionResult the runtime folded back into the next model request.
const snippetOutput = (mock: LiteLLMMock): Record<string, unknown> => {
  const result = mock.sandboxResult()
  expect(result, 'the sandbox result should be folded back into a model request').toBeDefined()
  return (result?.result ?? {}) as Record<string, unknown>
}

test.describe('code-exec sandbox isolation (#217)', () => {
  test('1. no network egress (connect-src none blocks fetch/XHR/WebSocket/beacon/EventSource)', async ({
    page
  }) => {
    const mock = await drive(page, snippets.NO_EGRESS)
    const out = snippetOutput(mock)

    // In-sandbox oracle: fetch and XHR exist in the Worker, so a `blocked:` here is
    // real `connect-src 'none'` enforcement (not API absence).
    expect(String(out.fetch), 'fetch must be CSP-blocked').toMatch(/^blocked:/)
    expect(String(out.xhr), 'XHR must be CSP-blocked').toMatch(/^blocked:/)
    // The rest are blocked or simply absent from Worker scope — either way no egress.
    for (const vector of ['websocket', 'sendBeacon', 'eventSource']) {
      expect(String(out[vector]), `${vector} must be blocked`).toMatch(/^blocked/)
    }

    // External oracle: a leaking sandbox would have reached the 200-fulfilling
    // sentinel route; under CSP the request never leaves the renderer.
    expect(mock.sentinelHits()).toEqual([])
  })

  test('2. no eval / new Function (no unsafe-eval in CSP)', async ({ page }) => {
    const out = snippetOutput(await drive(page, snippets.NO_EVAL))

    expect(String(out.eval), 'eval must throw').toMatch(/^blocked:/)
    expect(String(out.newFunction), 'new Function must throw').toMatch(/^blocked:/)
  })

  test('3. opaque origin (no parent/top DOM, storage, cookies, app URL)', async ({ page }) => {
    const out = snippetOutput(await drive(page, snippets.OPAQUE_ORIGIN))

    for (const surface of ['parent', 'top', 'localStorage', 'sessionStorage', 'cookie']) {
      expect(String(out[surface]), `${surface} must be unreachable`).toMatch(/^(unreachable|threw)/)
    }
    // Opaque-origin-specific: indexedDB exists in a Worker but must not open at an
    // opaque origin, and the Worker's own location must not be the app's origin.
    expect(out.indexedDB, 'indexedDB must not open at an opaque origin').not.toBe('OPENED')
    expect(out.locationLeaksAppOrigin, 'worker location must not leak the app origin').toBe(false)
  })

  test('4. no referrer leak (no-referrer; worker has no document.referrer)', async ({ page }) => {
    const mock = await drive(page, snippets.NO_REFERRER)
    const out = snippetOutput(mock)

    // In-sandbox: no document surface exists to read a referrer from.
    expect(out.hasDocument).toBe(false)
    expect(out.referrer).toBe('no-document')
    // External: nothing successfully reached the network, so no Referer was sent.
    expect(mock.sentinelHits()).toEqual([])
  })

  test('5. no resource loads (img-src/media-src none; importScripts blocked)', async ({ page }) => {
    const mock = await drive(page, snippets.NO_RESOURCE_LOADS)
    const out = snippetOutput(mock)

    // Image is absent from Worker scope; importScripts of a remote URL is CSP-blocked.
    expect(String(out.image)).toMatch(/^(unavailable|blocked)/)
    expect(String(out.importScripts)).toMatch(/^(unavailable|blocked)/)
    // External oracle catches a leak even if a vector swallowed its own error.
    expect(mock.sentinelHits()).toEqual([])
  })

  test('6. worker creation works (worker-src blob: in the sandboxed iframe)', async ({ page }) => {
    const mock = await drive(page, snippets.WORKER_WORKS)
    const out = snippetOutput(mock)

    // The benign computation ran and returned, proving the blob: Worker functions.
    expect(mock.sandboxResult()?.ok, 'a benign run should succeed').toBe(true)
    expect(out.sum).toBe(2)
    expect(out.ran).toBe(true)
  })

  test('7. timeout terminates an infinite loop and the iframe is torn down', async ({ page }) => {
    const mock = await drive(page, snippets.INFINITE_LOOP)

    // The deadline fired and the run was reported as timed out.
    expect(mock.sandboxResult()?.timedOut, 'an infinite loop must time out').toBe(true)
    // No residual sandbox iframe remains in the page.
    await expect(page.locator(SANDBOX_IFRAME)).toHaveCount(0)
  })
})
