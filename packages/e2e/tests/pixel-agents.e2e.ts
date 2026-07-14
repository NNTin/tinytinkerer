import { expect, test } from '@playwright/test'
import { dismissFirstLoad } from '../fixtures/first-load'
import { installChatMock, sendMessage, SYNTHESIS_ANSWER } from '../fixtures/mock-litellm'
import {
  characterIds,
  enablePixelHooks,
  PIXEL_AGENTS_URL,
  readMessageLog,
  savedOfficeLayoutVersion,
  waitForOfficeFrame
} from '../fixtures/pixel-agents'

test.use({ viewport: { width: 1280, height: 800 } })

test('shows the persistent assistant agent and maps a chat run into office activity', async ({
  page
}) => {
  await enablePixelHooks(page)
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

  const frame = await waitForOfficeFrame(page)
  await expect.poll(() => characterIds(frame)).toEqual([1])

  await sendMessage(page, 'Show this assistant working in the office.')
  await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible({ timeout: 30_000 })

  await expect
    .poll(async () => {
      const log = await readMessageLog(frame)
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
    .toEqual({ active: true, activity: true, waiting: true })

  await expect.poll(() => characterIds(frame)).toEqual([1])
})
