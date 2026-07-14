import { expect, type Frame, type Page } from '@playwright/test'
import { requireShellPort } from './first-load'

// Shared Pixel Agents e2e wiring, used by tests/pixel-agents.e2e.ts and
// tests/pixel-agents-activity.e2e.ts. The office is a vendored third-party
// bundle inside a sandboxed iframe: everything a spec can observe goes through
// the upstream document's test hooks (`window.__pixelAgentsTestHooks`, gated on
// `window.__PIXEL_AGENTS_E2E`) or the workspace's IndexedDB record, so the
// hook plumbing, frame lookup, and DB reader live here once. Deliberately
// dependency-free beyond first-load.ts (like that file, this sits below both
// the chat-mock and canvas fixture stacks so either kind of spec can import it
// without pulling in the edge worker).

// The Pixel Agents shell is mounted with the other applications on the
// composed host origin.
export const PIXEL_AGENTS_URL = `http://localhost:${requireShellPort('E2E_PORT')}/pixel-agents/`

// The subset of the upstream bundle's test-hook surface these specs read. The
// messageLog records only scalar fields of each incoming bridge message
// (type/status/toolId/…) — never rich payloads like a layout object.
export type PixelTestHooks = {
  getCharacters?: () => Array<{ id: number }>
  messageLog?: Array<{ type: string; status?: string; toolId?: string }>
}

// The upstream office hooks are gated on window.__PIXEL_AGENTS_E2E, set via
// addInitScript so it reaches EVERY document this page context boots — install
// it before ANY navigation (a spec may plant the flag while on a different
// shell so a later pixel-agents office iframe still gets the hooks).
export const enablePixelHooks = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    ;(window as unknown as { __PIXEL_AGENTS_E2E: boolean }).__PIXEL_AGENTS_E2E = true
  })
}

// Wait for the office to boot (its canvas rendering inside the sandboxed
// iframe) and return the upstream document's Frame for hook evaluation.
// Re-call after a navigation/reload: each boot is a new frame/document.
// `.first()` because the office renders MORE canvases once a tile palette is
// open (each swatch is a canvas button); the main stage canvas is always first.
export const waitForOfficeFrame = async (page: Page): Promise<Frame> => {
  await expect(
    page.frameLocator('iframe[title="Pixel Agents office"]').locator('canvas').first()
  ).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => page.frames().some((candidate) => candidate.url().includes('/upstream/index.html')))
    .toBe(true)
  const frame = page.frames().find((candidate) => candidate.url().includes('/upstream/index.html'))
  if (!frame) throw new Error('Pixel Agents iframe was not available')
  return frame
}

export const characterIds = (frame: Frame): Promise<number[]> =>
  frame.evaluate(
    () =>
      (window as unknown as { __pixelAgentsTestHooks?: PixelTestHooks }).__pixelAgentsTestHooks
        ?.getCharacters?.()
        .map((character) => character.id) ?? []
  )

export const readMessageLog = (frame: Frame): Promise<NonNullable<PixelTestHooks['messageLog']>> =>
  frame.evaluate(
    () =>
      (window as unknown as { __pixelAgentsTestHooks?: PixelTestHooks }).__pixelAgentsTestHooks
        ?.messageLog ?? []
  )

// The saved office layout, read from the same IndexedDB record the workspace
// persists to (packages/app/pixel-agents/src/workspace-db.ts): database
// 'tinytinkerer-pixel-agents', store 'workspaces', id 'default'. The whole
// layout object — a restore assertion needs to compare it, not just version it.
export const savedOfficeLayout = (page: Page): Promise<Record<string, unknown> | null> =>
  page.evaluate(
    () =>
      new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const open = indexedDB.open('tinytinkerer-pixel-agents')
        open.onerror = () => reject(open.error ?? new Error('Could not open Pixel Agents database'))
        open.onsuccess = () => {
          const database = open.result
          const request = database
            .transaction('workspaces')
            .objectStore('workspaces')
            .get('default')
          request.onerror = () =>
            reject(request.error ?? new Error('Could not read Pixel Agents workspace'))
          request.onsuccess = () => {
            const value = request.result as { layout?: Record<string, unknown> } | undefined
            resolve(value?.layout ?? null)
            database.close()
          }
        }
      })
  )

// Just the saved layout's version (null when nothing is persisted yet or the
// record carries no numeric version) — the write-side spec's poll target.
export const savedOfficeLayoutVersion = async (page: Page): Promise<number | null> => {
  const layout = await savedOfficeLayout(page)
  return typeof layout?.version === 'number' ? layout.version : null
}
