import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test'

// Helpers for driving the canvas shell's embedded Excalidraw whiteboard. Unlike the
// chat specs these do NOT touch mock-litellm (no chat backend is needed — the
// whiteboard is independent), so this fixture stays self-contained and never pulls the
// in-process edge worker.

const requireShellPort = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be set. Run through \`pnpm --filter @tinytinkerer/e2e e2e\`.`)
  }
  return value
}

export const CANVAS_URL = `http://localhost:${requireShellPort('E2E_PORT_CANVAS')}/canvas/`
// The parent-origin localStorage key the harness persists the scene snapshot under
// (apps/canvas/src/canvas-page.tsx) and the BroadcastChannel the library relay listens
// on (packages/shared/excalidraw-protocol EXCALIDRAW_LIBRARY_CHANNEL).
export const SNAPSHOT_KEY = 'tinytinkerer:canvas-scene:v1'
export const LIBRARY_CHANNEL = 'tinytinkerer:canvas-library'
export const CANVAS_FRAME = 'iframe.app-harness-frame'

// A minimal but valid `.excalidrawlib` (one rectangle library item) used to stub the
// excalidraw.com library fetch; the shape mirrors what Excalidraw's own Blob loader
// accepts, so `updateLibrary` restores it into the canvas.
export const LIBRARY_FILE = JSON.stringify({
  type: 'excalidrawlib',
  version: 2,
  source: 'https://excalidraw.com',
  libraryItems: [
    {
      id: 'e2e-lib-item-1',
      status: 'published',
      created: 1,
      name: 'E2E Rect',
      elements: [
        {
          id: 'e2e-lib-el-1',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 60,
          angle: 0,
          strokeColor: '#1971c2',
          backgroundColor: '#a5d8ff',
          fillStyle: 'solid',
          strokeWidth: 2,
          strokeStyle: 'solid',
          roughness: 1,
          opacity: 100,
          seed: 1,
          version: 1,
          versionNonce: 1,
          isDeleted: false,
          groupIds: [],
          frameId: null,
          roundness: null,
          boundElements: null,
          updated: 1,
          link: null,
          locked: false
        }
      ]
    }
  ]
})

type Box = { x: number; y: number; width: number; height: number }

// First-load dialogs: decline telemetry (persisted, so it only appears once), then
// best-effort close a Settings modal if the shell opened one. `timeout` bounds the wait
// for the telemetry dialog — generous on first load, short after a reload (where the
// choice is already persisted and the dialog will not reappear).
export const dismissFirstLoad = async (page: Page, timeout = 15_000): Promise<void> => {
  const decline = page.getByRole('button', { name: 'Continue without' })
  await decline.waitFor({ state: 'visible', timeout }).catch(() => undefined)
  if (await decline.isVisible().catch(() => false)) {
    await decline.click()
    await expect(page.getByRole('dialog', { name: 'Telemetry' })).toBeHidden()
  }
  const settings = page.getByRole('dialog', { name: 'Settings' })
  if (await settings.isVisible().catch(() => false)) {
    await page
      .getByRole('button', { name: 'Close settings' })
      .first()
      .click()
      .catch(() => undefined)
    await settings.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
  }
}

// Collapse the floating chat so it stops overlaying the centre of the canvas — needed
// before interacting with Excalidraw's centred modals (e.g. the export dialog), which
// the parent chat panel otherwise sits on top of and intercepts clicks for.
export const minimizeChat = async (page: Page): Promise<void> => {
  const minimize = page.getByRole('button', { name: 'Minimize widget' })
  if (await minimize.isVisible().catch(() => false)) {
    await minimize.click()
    await minimize.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
  }
}

// Resolves once the harness has completed its bridge handshake with the iframe (the
// AppFrame sets data-app-frame-status="ready" only after the Excalidraw app answers).
export const waitForCanvasReady = async (page: Page): Promise<void> => {
  await page
    .locator(`${CANVAS_FRAME}[data-app-frame-status="ready"]`)
    .waitFor({ state: 'attached', timeout: 30_000 })
}

// Open the canvas hermetically: block the chat backend (the whiteboard degrades
// gracefully without it), dismiss first-load dialogs, and wait for the Excalidraw
// bridge to be ready. Returns the iframe handles and its bounding box.
export const openCanvas = async (
  page: Page
): Promise<{ frame: FrameLocator; iframe: Locator; box: Box }> => {
  await page.route('**/api/**', (route) => route.abort())
  await page.route('**/health', (route) => route.abort())
  // Force Excalidraw's anchor-download fallback in every frame: its File System Access
  // API path (window.showSaveFilePicker) opens a native save picker that can't be driven
  // headlessly, so an export would never emit a Playwright `download` event. Removing the
  // capability makes exports download via an <a download> instead.
  await page.addInitScript(() => {
    const w = window as unknown as { showSaveFilePicker?: unknown }
    try {
      delete w.showSaveFilePicker
    } catch {
      w.showSaveFilePicker = undefined
    }
  })
  await page.goto(CANVAS_URL)
  await dismissFirstLoad(page)
  await waitForCanvasReady(page)
  const iframe = page.locator(CANVAS_FRAME)
  const box = await iframe.boundingBox()
  if (!box) throw new Error('canvas iframe has no bounding box')
  return { frame: page.frameLocator(CANVAS_FRAME), iframe, box }
}

// A minimal view of a persisted Excalidraw element — enough for the geometry the
// line-alignment spec inspects. `points` is present on linear elements (line/arrow).
export type SnapshotElement = {
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
  points?: Array<[number, number]>
}

export const readSnapshot = (
  page: Page
): Promise<{ elements?: SnapshotElement[]; libraryItems?: unknown[] } | null> =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw
      ? (JSON.parse(raw) as { elements?: SnapshotElement[]; libraryItems?: unknown[] })
      : null
  }, SNAPSHOT_KEY)

// Drive the REAL `draw` verb over the app-bridge, exactly as the model does in
// production: post a `req` envelope (packages/shared/app-bridge protocol) from the top
// (harness) window to the sandboxed iframe, which the bridge server trusts because
// `event.source` is its parent and the session nonce matches. The nonce is the same
// per-mount secret the harness appends to the iframe URL (app-bridge-nonce=...), so we
// read it straight off the iframe `src`. This exercises the true pipeline —
// defineBridgeVerb('draw') -> executeDraw -> convertToExcalidrawElements — so bugs in
// element normalization reproduce authentically, unlike the jsdom unit tests which mock
// convertToExcalidrawElements away. Resolves with the verb result (draw receipts).
export const drawViaVerb = async (
  page: Page,
  elements: ReadonlyArray<Record<string, unknown>>,
  options: { connectors?: ReadonlyArray<Record<string, unknown>>; replace?: boolean } = {}
): Promise<{ ok: boolean; drawn?: number }> => {
  const nonce = await page.locator(CANVAS_FRAME).evaluate((frame) => {
    // The harness passes the per-mount nonce in the iframe URL *fragment*
    // (#app-bridge-nonce=...), never the query string (see app-frame.tsx).
    const hash = new URL((frame as HTMLIFrameElement).src).hash.replace(/^#/, '')
    return new URLSearchParams(hash).get('app-bridge-nonce') ?? ''
  })
  if (!nonce) throw new Error('canvas iframe is missing its app-bridge-nonce')
  return page.evaluate(
    ({ frameSelector, sessionNonce, payload }) =>
      new Promise<{ ok: boolean; drawn?: number }>((resolve, reject) => {
        const target = document.querySelector<HTMLIFrameElement>(frameSelector)?.contentWindow
        if (!target) return reject(new Error('canvas iframe has no contentWindow'))
        const id = `e2e-draw-${Math.random().toString(36).slice(2)}`
        const timer = window.setTimeout(() => {
          window.removeEventListener('message', onMessage)
          reject(new Error('draw verb timed out'))
        }, 15_000)
        const onMessage = (event: MessageEvent): void => {
          if (event.source !== target) return
          const data = event.data as {
            kind?: string
            id?: string
            ok?: boolean
            result?: { ok: boolean; drawn?: number }
            error?: string
          }
          if (data?.kind !== 'res' || data.id !== id) return
          window.clearTimeout(timer)
          window.removeEventListener('message', onMessage)
          if (data.ok) resolve(data.result ?? { ok: true })
          else reject(new Error(data.error ?? 'draw verb failed'))
        }
        window.addEventListener('message', onMessage)
        // protocolVersion must match APP_BRIDGE_PROTOCOL_VERSION (2); the server drops
        // envelopes on any other version, nonce mismatch, or foreign event.source.
        target.postMessage(
          { kind: 'req', protocolVersion: 2, sessionNonce, id, verb: 'draw', payload },
          '*'
        )
      }),
    {
      frameSelector: CANVAS_FRAME,
      sessionNonce: nonce,
      payload: {
        elements,
        connectors: options.connectors ?? [],
        ...(options.replace === undefined ? {} : { replace: options.replace })
      }
    }
  )
}

// Draw a rectangle in the clear canvas to the RIGHT of the floating chat panel (which
// covers the centre) using the real toolbar tool + a pointer drag. The tool <input> is
// visually behind its icon, so it needs a forced click.
export const drawRectangle = async (page: Page, frame: FrameLocator, box: Box): Promise<void> => {
  await frame.locator('[data-testid="toolbar-rectangle"]').click({ force: true })
  await page.mouse.move(box.x + 920, box.y + 250)
  await page.mouse.down()
  await page.mouse.move(box.x + 1160, box.y + 480, { steps: 12 })
  await page.mouse.up()
}

// Emit a library-import message on the same-origin channel the canvas relay listens on,
// exactly as the library-callback page does.
export const postLibraryMessage = (
  page: Page,
  message: { libraryUrl: string; idToken?: string }
): Promise<void> =>
  page.evaluate(
    ({ channel, msg }) => {
      new BroadcastChannel(channel).postMessage(msg)
    },
    { channel: LIBRARY_CHANNEL, msg: message }
  )
