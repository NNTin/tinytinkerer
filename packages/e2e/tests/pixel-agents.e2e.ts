import { expect, test } from '@playwright/test'
import { dismissFirstLoad, requireShellPort } from '../fixtures/first-load'
import { installChatMock, sendMessage, SYNTHESIS_ANSWER } from '../fixtures/mock-litellm'

const PIXEL_AGENTS_URL = `http://localhost:${requireShellPort('E2E_PORT')}/pixel-agents/`

type PixelTestHooks = {
  getCharacters?: () => Array<{ id: number }>
  messageLog?: Array<{ type: string; status?: string; toolId?: string }>
}

const savedOfficeLayoutVersion = (page: import('@playwright/test').Page): Promise<number | null> =>
  page.evaluate(
    () =>
      new Promise<number | null>((resolve, reject) => {
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
            const value = request.result as { layout?: { version?: unknown } } | undefined
            resolve(typeof value?.layout?.version === 'number' ? value.layout.version : null)
            database.close()
          }
        }
      })
  )

test.use({ viewport: { width: 1280, height: 800 } })

test('shows the persistent assistant agent and maps a chat run into office activity', async ({
  page
}) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __PIXEL_AGENTS_E2E: boolean }).__PIXEL_AGENTS_E2E = true
  })
  await installChatMock(page)
  await page.goto(PIXEL_AGENTS_URL)
  await dismissFirstLoad(page)

  await expect(page.getByRole('main', { name: 'TinyTinkerer Pixel Agents' })).toBeVisible()
  const officeFrame = page.frameLocator('iframe[title="Pixel Agents office"]')
  await expect(officeFrame.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await expect(officeFrame.getByTitle('Zoom in (Ctrl+Scroll)')).toBeVisible()
  await expect(officeFrame.getByRole('button', { name: 'Layout' })).toBeVisible()
  await expect(officeFrame.getByTitle('Settings')).toBeHidden()

  await officeFrame.getByRole('button', { name: 'Layout' }).click()
  await officeFrame.getByTitle('Paint floor tiles').click()
  await officeFrame
    .locator('canvas')
    .first()
    .click({ position: { x: 360, y: 240 } })
  await expect.poll(() => savedOfficeLayoutVersion(page)).toBe(1)

  await expect
    .poll(() => page.frames().some((candidate) => candidate.url().includes('/upstream/index.html')))
    .toBe(true)
  const frame = page.frames().find((candidate) => candidate.url().includes('/upstream/index.html'))
  if (!frame) throw new Error('Pixel Agents iframe was not available')

  await expect
    .poll(() =>
      frame.evaluate(() => {
        const hooks = (window as unknown as { __pixelAgentsTestHooks?: PixelTestHooks })
          .__pixelAgentsTestHooks
        return hooks?.getCharacters?.().map((character) => character.id) ?? []
      })
    )
    .toEqual([1])

  await sendMessage(page, 'Show this assistant working in the office.')
  await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

  await expect
    .poll(() =>
      frame.evaluate(() => {
        const log =
          (window as unknown as { __pixelAgentsTestHooks?: PixelTestHooks }).__pixelAgentsTestHooks
            ?.messageLog ?? []
        return {
          active: log.some(
            (message) => message.type === 'agentStatus' && message.status === 'active'
          ),
          activity: log.some((message) => message.type === 'agentToolStart'),
          waiting: log.some(
            (message) => message.type === 'agentStatus' && message.status === 'waiting'
          )
        }
      })
    )
    .toEqual({ active: true, activity: true, waiting: true })

  await expect
    .poll(() =>
      frame.evaluate(
        () =>
          (window as unknown as { __pixelAgentsTestHooks?: PixelTestHooks }).__pixelAgentsTestHooks
            ?.getCharacters?.()
            .map((character) => character.id) ?? []
      )
    )
    .toEqual([1])
})
