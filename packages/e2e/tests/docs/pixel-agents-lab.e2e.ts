import { test, expect } from '@playwright/test'
import { dismissFirstLoad } from '../../fixtures/first-load'
import { installChatMock, sendMessage, SYNTHESIS_ANSWER } from '../../fixtures/mock-litellm'
import { enablePixelHooks, waitForOfficeFrame } from '../../fixtures/pixel-agents'
import {
  docsLabSignedOutNotice,
  docsLabSignInButton,
  PIXEL_AGENTS_LAB_URL,
  seedDocsHostToken,
  waitForDocsLabSignedIn
} from '../../fixtures/docs-lab'

// The docs site's "Try Pixel Agents" live lab (docs/extending/interactive-labs.md,
// apps/docs/src/live-lab/pixel-agents/) embeds the REAL ChatApp + PixelAgentsStage
// components against a docs-isolated session — real browser, real IndexedDB, real
// (mocked-upstream) chat round-trip, not the mock-boundary unit tests in
// apps/docs/src/live-lab/__tests__/.
test.use({ viewport: { width: 1280, height: 800 } })

const switcherStatus = (page: import('@playwright/test').Page) =>
  page.locator(
    '.pixel-agents-lab__switcher-select[aria-current="true"] .pixel-agents-lab__switcher-status'
  )

test.describe('docs pixel agents lab (#452, #470)', () => {
  test('signed-out visitor is not blocked from using the lab', async ({ page }) => {
    await installChatMock(page)
    await page.goto(PIXEL_AGENTS_LAB_URL)
    await dismissFirstLoad(page)

    // The non-blocking signed-out notice + CTA render...
    await expect(docsLabSignedOutNotice(page)).toBeVisible()
    await expect(docsLabSignInButton(page)).toBeVisible()

    // ...but the lab itself is still fully usable without signing in.
    await page.getByRole('button', { name: 'New conversation', exact: true }).click()
    await sendMessage(page, 'Hello from an anonymous visitor.')

    await expect
      .poll(() => switcherStatus(page).textContent(), {
        message:
          'expected the active conversation to reach a terminal status after the mocked reply'
      })
      .toMatch(/Completed|Last run failed/)
    await expect(page.getByText(SYNTHESIS_ANSWER)).toBeVisible()
  })

  test('signed-in visitor sees no sign-in notice and can use the lab', async ({ page }) => {
    await installChatMock(page, 'Hello there!')
    await seedDocsHostToken(page)
    await page.goto(PIXEL_AGENTS_LAB_URL)
    await dismissFirstLoad(page)
    await waitForDocsLabSignedIn(page)

    await expect(docsLabSignInButton(page)).toHaveCount(0)

    await page.getByRole('button', { name: 'New conversation', exact: true }).click()
    await sendMessage(page, 'Hello from a signed-in visitor.')

    await expect
      .poll(() => switcherStatus(page).textContent(), {
        message:
          'expected the active conversation to reach a terminal status after the mocked reply'
      })
      .toMatch(/Completed|Last run failed/)
    await expect(page.getByText('Hello there!')).toBeVisible()
  })

  test('the Pixel Agents office iframe boots inside the lab', async ({ page }) => {
    await installChatMock(page)
    await enablePixelHooks(page)
    await page.goto(PIXEL_AGENTS_LAB_URL)
    await dismissFirstLoad(page)

    const frame = await waitForOfficeFrame(page)
    expect(frame.url()).toContain('/upstream/index.html')

    await page.getByRole('button', { name: 'New conversation', exact: true }).click()
    await sendMessage(page, 'Say hello.')
    await expect
      .poll(() => switcherStatus(page).textContent(), {
        message:
          'expected the active conversation to reach a terminal status after the mocked reply'
      })
      .toMatch(/Completed|Last run failed/)
  })

  test('"Reset this lab" clears the docs-isolated session', async ({ page }) => {
    await installChatMock(page)
    await page.goto(PIXEL_AGENTS_LAB_URL)
    await dismissFirstLoad(page)

    // A fresh session already starts with one default draft conversation, so
    // this only asserts "at least one exists", not an exact count.
    await page.getByRole('button', { name: 'New conversation', exact: true }).click()
    await expect(page.locator('.pixel-agents-lab__switcher-item').first()).toBeVisible()

    await page.getByRole('button', { name: 'Reset this lab' }).click()
    await dismissFirstLoad(page)

    await expect
      .poll(() => page.locator('.pixel-agents-lab__switcher-item').count(), {
        message: 'expected the conversation list to be empty after resetting the lab session'
      })
      .toBe(0)
  })

  test('Fullscreen grows the lab beyond its default in-page size', async ({ page }) => {
    // Taller than this file's usual 1280x800: the fullscreen box is
    // viewport-sized, and this page's stage only grows past its 32rem floor
    // once the notice/switcher/signed-out-CTA content above it leaves genuine
    // leftover space — verified empirically that an 800px-tall viewport can
    // leave exactly zero (stage correctly holds its floor, not a bug), while
    // this height reliably leaves room to demonstrate real growth.
    await page.setViewportSize({ width: 1280, height: 1400 })
    await installChatMock(page)
    await page.goto(PIXEL_AGENTS_LAB_URL)
    await dismissFirstLoad(page)

    // Scoped to the interactive stage/fallback itself, not `.lab-container__body`
    // as a whole: the body also holds the switcher/notice/reset button, so its
    // total height is bounded by the fullscreen viewport box and can end up
    // SMALLER than its in-flow height once other content in the box competes for
    // space — see custom.css's `.lab-container--fullscreen .pixel-agents-lab__stage`
    // (`flex: 1 1 auto; min-height: 32rem`) for why the stage itself is what's
    // guaranteed to grow.
    const stage = page.locator('.pixel-agents-lab__stage, .pixel-agents-lab__fallback').first()
    const before = await stage.boundingBox()
    expect(before).not.toBeNull()

    const toggle = page.getByRole('button', { name: 'Fullscreen', exact: true })
    await toggle.click()

    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible()
    await expect(toggle).toHaveCount(0)
    await expect(page.locator('.lab-container--fullscreen')).toBeVisible()

    const after = await stage.boundingBox()
    expect(after).not.toBeNull()
    expect(after!.height).toBeGreaterThan(before!.height)
  })
})
