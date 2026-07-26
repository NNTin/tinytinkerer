import { expect, type Page } from '@playwright/test'
import { requireShellPort } from './first-load'

// Shared docs live-lab e2e wiring, used by tests/docs/*.e2e.ts. The Docusaurus
// docs site is composed into the SAME origin as every other product shell
// (turbo.json's `@tinytinkerer/host#build` depends on `@tinytinkerer/docs#build`,
// and apps/host/src/build-pages.mjs copies apps/docs/build -> apps/host/dist/docs)
// so no new webServer/port is needed here — these URLs just point at `/docs/**`
// on the SAME composed origin PIXEL_AGENTS_URL etc. already use.
const DOCS_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}`

export const PIXEL_AGENTS_LAB_URL = `${DOCS_ORIGIN}/docs/extending/interactive-labs/`
export const EXECUTION_TRACE_LAB_URL = `${DOCS_ORIGIN}/docs/extending/execution-trace/`
export const PLUGIN_TOOL_PICKER_LAB_URL = `${DOCS_ORIGIN}/docs/plugins-and-tools/plugin-tool-picker-lab/`
export const RICH_CONTENT_PLAYGROUND_URL = `${DOCS_ORIGIN}/docs/extending/rich-content-playground/`

// The docs LiveLab framework's auth peek (apps/docs/src/live-lab/client-runtime.tsx's
// buildDocsLabApp -> createBrowserShell({}).authTokens.getStoredToken()) reads the
// PRODUCT's own DEFAULT-namespace IndexedDB, NOT the docs-lab-isolated database —
// a Dexie database named 'tinytinkerer' (packages/app/app-browser/src/config.ts's
// DEFAULT_CONFIG.storageNamespace), object store 'preferences' (keyPath 'key'),
// record { key: 'github_access_token', value: <token> } (db.ts's
// authTokens.setStoredToken). Real sign-in is a full-page redirect to github.com
// (no popup), so completing it live in e2e is impossible — this seeds the same
// storage location directly instead.
//
// Seeded via a raw indexedDB.open (page-evaluated code has no Dexie import
// available), matching TinyTinkererDb's CURRENT schema exactly (db.ts's
// version(3).stores(): conversations 'id,updatedAt', events
// 'id,conversationId,timestamp', preferences 'key'). Because this only ever runs
// against a brand-new database (first ever open in a fresh browser context), a
// single-version open at version 3 that creates the final store shapes directly
// is indistinguishable, on disk, from Dexie stepping through versions 1->2->3 on
// an empty database (those upgrade() functions only transform EXISTING rows).
//
// A seeded token is otherwise useless on its own: any authenticated request
// (chat, search, MCP) makes the edge worker validate the caller by probing the
// REAL `https://api.github.com/user` with the token as a Bearer credential
// (apps/edge/src/lib/caller-validation.ts's validateLiteLLMCaller). Unlike
// `mock-litellm.ts`'s edge routes, this probe is NOT a browser-page request:
// `fixtures/mock-litellm.ts`'s `pipeToEdge` runs the edge's `app.fetch` handler
// directly inside the Playwright/Node test process (that's how it can call the
// real edge Hono app in-process), so `validateLiteLLMCaller`'s own outbound
// `fetch('https://api.github.com/user')` call is a NODE-side fetch, invisible
// to `page.route()` — confirmed empirically: a `page.route` mock for this URL
// only ever caught ONE client-side check the app itself makes, never the
// edge's own per-request validation, which kept 401ing against the real
// GitHub API. So this patches Node's own `globalThis.fetch` too, exactly
// mirroring `mock-litellm.ts`'s `installLiteLLMUpstream` pattern: intercept
// only this one URL, fall through to the previous fetch for everything else,
// patch at most once per process.
let githubUserFetchPatched = false
const patchGitHubUserFetch = (identity: { id: number; login: string }): void => {
  if (githubUserFetchPatched) return
  githubUserFetchPatched = true
  const previousFetch = globalThis.fetch
  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === 'https://api.github.com/user') {
      return Promise.resolve(
        new Response(JSON.stringify(identity), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    }
    return previousFetch(input, init)
  }
}

// Registered via page.addInitScript so it runs before ANY page script on every
// document this page navigates to — must be called BEFORE page.goto().
export const seedDocsHostToken = async (
  page: Page,
  token = 'e2e-docs-lab-token'
): Promise<void> => {
  const identity = { id: 987_654, login: 'e2e-docs-lab-user' }
  patchGitHubUserFetch(identity)
  // Also mocked at the page/browser level: the app itself makes its own
  // client-side check against this same URL (separate from the edge's
  // server-side validation above) to help decide its signed-in UI state.
  await page.route('https://api.github.com/user', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(identity)
    })
  )
  await page.addInitScript((seededToken: string) => {
    // Only the top-level document needs the seeded token — running this same
    // indexedDB.open inside the sandboxed Pixel Agents office iframe (an
    // opaque-origin context) throws ("access to the Indexed Database API is
    // denied in this context"), harmlessly, since nothing there reads it; skip
    // it there so that error never appears in a test's console output.
    if (window.top !== window.self) {
      return
    }
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('tinytinkerer', 3)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('conversations')) {
          db.createObjectStore('conversations', { keyPath: 'id' }).createIndex(
            'updatedAt',
            'updatedAt'
          )
        }
        if (!db.objectStoreNames.contains('events')) {
          const events = db.createObjectStore('events', { keyPath: 'id' })
          events.createIndex('conversationId', 'conversationId')
          events.createIndex('timestamp', 'timestamp')
        }
        if (!db.objectStoreNames.contains('preferences')) {
          db.createObjectStore('preferences', { keyPath: 'key' })
        }
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('preferences', 'readwrite')
        tx.objectStore('preferences').put({ key: 'github_access_token', value: seededToken })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('Failed to seed the auth token.'))
      }
      request.onerror = () => reject(request.error ?? new Error('Failed to open tinytinkerer DB.'))
    })
  }, token)
}

// Scoped to the live-lab framework's own classes, NOT
// `getByRole('button', { name: 'Sign in with GitHub' })` — ChatApp's composer has
// an unrelated same-named button (opens Settings) that co-exists on the page once
// the lab mounts, so a role/name locator alone would be ambiguous.
export const docsLabSignInButton = (page: Page) => page.locator('.live-lab__sign-in')
export const docsLabSignedOutNotice = (page: Page) => page.locator('.live-lab__signed-out-notice')

// Defensive readiness check: the seeded token is read asynchronously during
// ClientRuntime's bootstrap effect, so poll for the notice's absence rather than
// assuming any fixed timing.
export const waitForDocsLabSignedIn = (page: Page): Promise<void> =>
  expect
    .poll(() => docsLabSignedOutNotice(page).isVisible(), {
      message: 'expected the signed-out notice to be ABSENT once the seeded host token is picked up'
    })
    .toBe(false)
