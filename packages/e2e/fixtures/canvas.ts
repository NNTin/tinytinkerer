import { type Locator, type Page } from '@playwright/test'
import { dismissFirstLoad, requireShellPort } from './first-load'

// The integrated canvas is mounted with the other applications on the composed host.
export const CANVAS_URL = `http://localhost:${requireShellPort('E2E_PORT')}/canvas/`
export const LIBRARY_CHANNEL = 'tinytinkerer:canvas-library'
const CANVAS_DATABASE = 'tinytinkerer-canvas'
const CANVAS_WORKSPACE = 'default'

// A minimal but valid `.excalidrawlib` (one rectangle library item) used to stub the
// excalidraw.com library fetch.
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

export const canvasStage = (page: Page): Locator =>
  page.locator('.app-dock-panel[data-panel-id="canvas"] .canvas-whiteboard')

export const waitForCanvasReady = async (page: Page): Promise<void> => {
  await canvasStage(page).locator('.excalidraw').waitFor({ state: 'visible', timeout: 30_000 })
}

// Open the canvas hermetically: block the chat backend, dismiss first-load dialogs,
// and wait for the directly mounted Excalidraw stage.
export const openCanvas = async (page: Page): Promise<{ canvas: Locator; box: Box }> => {
  await page.route('**/api/**', (route) => route.abort())
  await page.route('**/health', (route) => route.abort())
  // Force browser-fs-access's anchor-download fallback. It selects its native path
  // from showOpenFilePicker (then calls showSaveFilePicker), so both capabilities
  // must be absent before Excalidraw's module is evaluated. Native save pickers
  // cannot be driven headlessly; the fallback produces a Playwright download event.
  await page.addInitScript(() => {
    const browserWindow = window as unknown as Record<string, unknown>
    for (const capability of ['showOpenFilePicker', 'showSaveFilePicker']) {
      try {
        delete browserWindow[capability]
      } catch {
        browserWindow[capability] = undefined
      }
    }
  })
  await page.goto(CANVAS_URL)
  await dismissFirstLoad(page)
  await waitForCanvasReady(page)
  const canvas = canvasStage(page)
  const box = await canvas.locator('canvas.excalidraw__canvas.interactive').boundingBox()
  if (!box) throw new Error('interactive canvas has no bounding box')
  return { canvas, box }
}

// Minimal persisted element view for browser geometry assertions.
export type SnapshotElement = {
  id?: string
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
  points?: Array<[number, number]>
}

type CanvasSnapshot = { elements?: SnapshotElement[]; libraryItems?: unknown[] }
type CanvasWorkspaceRecord = { snapshot?: CanvasSnapshot }

// Read the same IndexedDB record used by the integrated canvas workspace.
export const readSnapshot = (page: Page): Promise<CanvasSnapshot | null> =>
  page.evaluate(
    ({ databaseName, workspaceId }) =>
      new Promise<CanvasSnapshot | null>((resolve, reject) => {
        const request = indexedDB.open(databaseName)
        request.onerror = () => reject(request.error ?? new Error('Unable to open canvas database'))
        request.onsuccess = () => {
          const database = request.result
          if (!database.objectStoreNames.contains('workspaces')) {
            database.close()
            resolve(null)
            return
          }
          const transaction = database.transaction('workspaces', 'readonly')
          const get = transaction.objectStore('workspaces').get(workspaceId)
          get.onerror = () => reject(get.error ?? new Error('Unable to read canvas workspace'))
          get.onsuccess = () => {
            const record = get.result as CanvasWorkspaceRecord | undefined
            resolve(record?.snapshot ?? null)
          }
          transaction.oncomplete = () => database.close()
        }
      }),
    { databaseName: CANVAS_DATABASE, workspaceId: CANVAS_WORKSPACE }
  )

// Draw a rectangle through the real Excalidraw toolbar and pointer interactions.
export const drawRectangle = async (page: Page, canvas: Locator, box: Box): Promise<void> => {
  await canvas.locator('[data-testid="toolbar-rectangle"]').click({ force: true })
  // The directly mounted canvas occupies one dock panel, so Excalidraw uses its
  // compact layout. Draw in the lower-right content area, clear of the properties
  // panel, centred toolbar, and canvas controls that overlay the backing canvas.
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.65, { steps: 12 })
  await page.mouse.up()
}

// Emit the same library-import message as the library callback page.
export const postLibraryMessage = (
  page: Page,
  message: { libraryUrl: string; idToken?: string }
): Promise<void> =>
  page.evaluate(
    ({ channel, msg }) => {
      const relay = new BroadcastChannel(channel)
      relay.postMessage(msg)
      relay.close()
    },
    { channel: LIBRARY_CHANNEL, msg: message }
  )
