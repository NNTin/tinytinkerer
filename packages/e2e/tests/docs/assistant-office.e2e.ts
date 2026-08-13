import { test, expect, type Frame, type Page } from '@playwright/test'
import { dismissFirstLoad, requireShellPort } from '../../fixtures/first-load'
import { installChatMock } from '../../fixtures/mock-litellm'
import {
  addAgentButton,
  characterIds,
  enablePixelHooks,
  readMessageLog,
  waitForOfficeFrame
} from '../../fixtures/pixel-agents'

// The Pixel Agents Office in the documentation sidebar, on the BUILT site
// (issue #472).
//
// This is the documentation assistant's ONLY conversation-management surface:
// `ChatApp` has had no switcher on any shell since the office became the
// product's sole one, so without this a reader has one assistant conversation
// and no way to leave it. The assertions here are the ones only a real build
// and a real sandboxed iframe can make — that the sidebar costs nothing until
// asked, that the office really boots under `/docs/**`'s asset paths, and that
// selection and creation cross the postMessage bridge in both directions.
//
// The model is mocked (`installChatMock`) so none of this consumes quota;
// nothing here sends a prompt.
test.use({ viewport: { width: 1280, height: 900 } })

const DOCS_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}`
const AUTHORED = `${DOCS_ORIGIN}/docs/architecture/`
const NESTED = `${DOCS_ORIGIN}/docs/plugins-and-tools/`
const SEARCH = `${DOCS_ORIGIN}/docs/search/`

const slot = (page: Page) => page.getByRole('region', { name: 'Agent office' })
const activateOffice = (page: Page) =>
  page.getByRole('button', { name: 'Show your assistant conversations' })
const officeFrames = (page: Page) => page.locator('iframe[title="Pixel Agents office"]')
const conversationsDisclosure = (page: Page) => page.getByText(/^Conversations \(\d+\)$/)
const conversationRows = (page: Page) => page.locator('.docs-assistant-office__switcher-select')
/** Which character the office was last told to select, from its own message log. */
const lastSelectedAgentId = async (frame: Frame): Promise<number | undefined> =>
  (await readMessageLog(frame)).filter((message) => message.type === 'agentSelected').at(-1)?.id

/**
 * Activates the runtime from the sidebar and waits for the room to render.
 *
 * The dismissal is not incidental setup: the assistant owns the documentation
 * site's telemetry consent and settings hosts (issue #479), so the FIRST thing
 * activating from the sidebar does is open those over the page. Their overlays
 * are `fixed inset-0` and intercept every pointer event, including clicks meant
 * for the office iframe underneath.
 */
const openOffice = async (page: Page) => {
  await activateOffice(page).click()
  const frame = await waitForOfficeFrame(page)
  await dismissFirstLoad(page)
  return frame
}

test.describe('the documentation sidebar office (#472)', () => {
  test('costs nothing until a reader asks for it', async ({ page }) => {
    const upstreamRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/upstream/')) upstreamRequests.push(request.url())
    })

    await installChatMock(page)
    await page.goto(AUTHORED)

    await expect(slot(page)).toBeVisible()
    await expect(activateOffice(page)).toBeVisible()
    // No frame, and nothing fetched from the prepared upstream bundle. The
    // cold-page byte budget is enforced separately (assistant-performance);
    // what this pins is that the sidebar itself does not trigger any of it.
    await expect(officeFrames(page)).toHaveCount(0)
    expect(upstreamRequests).toEqual([])
  })

  test('boots the office with compact chrome once activated', async ({ page }) => {
    await enablePixelHooks(page)
    await installChatMock(page)
    await page.goto(AUTHORED)

    await openOffice(page)
    const office = page.frameLocator('iframe[title="Pixel Agents office"]')

    // Compact chrome (issue #472): the office is ~300px wide here, so upstream's
    // zoom buttons are hidden and it starts at minimum zoom. "+ Agent" and
    // "Layout" stay — they are the controls a reader actually needs.
    await expect(office.getByTitle('Zoom in (Ctrl+Scroll)')).toBeHidden()
    await expect(office.getByTitle('Zoom out (Ctrl+Scroll)')).toBeHidden()
    await expect(office.getByRole('button', { name: '+ Agent' })).toBeVisible()
    await expect(office.getByTitle('Settings')).toBeHidden()

    // The frame carries the request that switched all of that on, resolved
    // against the site's asset base rather than the current nested route.
    const frame = page.frames().find((candidate) => candidate.url().includes('/upstream/'))
    expect(frame?.url()).toContain('tinytinkerer-chrome=compact')
  })

  test('creates and selects assistant conversations across the bridge, in both directions', async ({
    page
  }) => {
    await enablePixelHooks(page)
    await installChatMock(page)
    await page.goto(AUTHORED)

    const frame = await openOffice(page)
    await expect.poll(() => characterIds(frame)).toEqual([1])

    // Office -> host: a real click on upstream's own "+ Agent" button, inside
    // the sandboxed frame, has to come back as a new ASSISTANT conversation.
    await addAgentButton(page).click()
    await expect.poll(() => characterIds(frame)).toHaveLength(2)

    await conversationsDisclosure(page).click()
    await expect(conversationRows(page)).toHaveCount(2)
    // A new conversation is prepended and selected. Rows, not titles: an
    // untitled conversation is called "New conversation" until its first
    // message, so both of these read identically.
    await expect(conversationRows(page).nth(0)).toHaveAttribute('aria-current', 'true')

    // Host -> office: selecting the other conversation from the accessible list
    // must move the office's selection too. Read off the office's own message
    // log rather than the host's DOM — the point of this half is that the
    // selection crossed the bridge, not that the list re-rendered.
    const selectedBefore = await lastSelectedAgentId(frame)
    await conversationRows(page).nth(1).click()
    await expect(conversationRows(page).nth(1)).toHaveAttribute('aria-current', 'true')
    await expect.poll(() => lastSelectedAgentId(frame)).not.toBe(selectedBefore)

    // And deleting from the list retires the character.
    await page
      .getByRole('button', { name: /^Delete conversation/ })
      .first()
      .click()
    await page.getByRole('button', { name: /^Confirm deleting conversation/ }).click()
    await expect.poll(() => characterIds(frame)).toHaveLength(1)
  })

  test('collapsing unmounts the office rather than hiding it, and the choice sticks', async ({
    page
  }) => {
    await installChatMock(page)
    await page.goto(AUTHORED)
    await openOffice(page)

    await page.getByRole('button', { name: 'Hide', exact: true }).click()
    // Unmounted, not `display: none` — the iframe is gone, so nothing keeps
    // animating in a sidebar the reader closed.
    await expect(officeFrames(page)).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('button', { name: 'Show', exact: true })).toBeVisible()
    await expect(officeFrames(page)).toHaveCount(0)

    await page.getByRole('button', { name: 'Show', exact: true }).click()
    await expect(officeFrames(page)).toHaveCount(1)
  })

  test('survives client-side navigation without restarting the session', async ({ page }) => {
    await enablePixelHooks(page)
    await installChatMock(page)
    await page.goto(AUTHORED)

    const frame = await openOffice(page)
    await addAgentButton(page).click()
    await expect.poll(() => characterIds(frame)).toHaveLength(2)

    // A Docusaurus SPA navigation. `@theme/Root` and the assistant host outlive
    // it; the sidebar slot does not — it remounts and re-registers its target,
    // which is precisely the transition the portal contract exists to survive.
    await page
      .getByRole('navigation', { name: 'Docs sidebar' })
      .getByRole('link', { name: 'Plugins & Tools' })
      .first()
      .click()
    await expect(page).toHaveURL(NESTED)

    const reboot = await waitForOfficeFrame(page)
    await expect.poll(() => characterIds(reboot)).toHaveLength(2)
    await conversationsDisclosure(page).click()
    await expect(conversationRows(page)).toHaveCount(2)
  })

  test('is absent where the documentation has no sidebar', async ({ page }) => {
    await installChatMock(page)

    await page.goto(SEARCH)
    await expect(slot(page)).toHaveCount(0)
    await expect(officeFrames(page)).toHaveCount(0)

    const response = await page.goto(`${DOCS_ORIGIN}/docs/definitely-missing-office-route`)
    expect(response?.status()).toBe(404)
    await expect(slot(page)).toHaveCount(0)
    await expect(officeFrames(page)).toHaveCount(0)
  })
})
