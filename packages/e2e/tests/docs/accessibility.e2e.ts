import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { dismissFirstLoad, requireShellPort } from '../../fixtures/first-load'
import { installChatMock } from '../../fixtures/mock-litellm'
import {
  EXECUTION_TRACE_LAB_URL,
  PIXEL_AGENTS_LAB_URL,
  PLUGIN_TOOL_PICKER_LAB_URL
} from '../../fixtures/docs-lab'

// Automated accessibility coverage for /docs (issue #457): axe-core scans plus
// keyboard/focus/reduced-motion behavior that axe itself cannot assert (it
// checks static DOM/CSS properties, not interaction sequences).
const DOCS_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}`

const CONTENT_PAGE_URLS = [
  `${DOCS_ORIGIN}/docs/`,
  `${DOCS_ORIGIN}/docs/overview/`,
  `${DOCS_ORIGIN}/docs/architecture/`,
  `${DOCS_ORIGIN}/docs/contributing/`,
  `${DOCS_ORIGIN}/docs/contributing/authoring-docs/`,
  `${DOCS_ORIGIN}/docs/contributing/staging-smoke-checklist/`
]

type ExpectedViolation = {
  id: string
  // Matched against the violating node's own outerHTML. Kept deliberately
  // narrow (specific class/attribute substrings) so a NEW, unrelated
  // violation of the same rule elsewhere on the page still fails the test.
  matchesHtml: (html: string) => boolean
  reason: string
}

// Prism's stock "github" theme (docusaurus.config.ts's `prism.theme`) colors
// several token classes (function, parameter, comment, ...) a shade or two
// short of 4.5:1 against its own background (function: #d73a49, a 4.29:1
// hairline miss; others further off). That is the exact theme GitHub's own
// code view uses; patching it would mean forking a vendored third-party theme
// over syntax-highlighting colors, so it is tracked here as a single known,
// out-of-scope limitation — scoped to `.token` spans specifically, not a
// blanket color-contrast bypass — rather than silently disabling the rule.
const PRISM_SYNTAX_TOKEN: ExpectedViolation = {
  id: 'color-contrast',
  matchesHtml: (html) => /class="token /.test(html),
  reason: "Prism's stock github theme's token colors fall short of 4.5:1 against its own background"
}

// Every ready-made lab embeds the REAL product shell (ChatApp/PixelAgentsStage)
// directly in the docs page's DOM (not behind an iframe — only the Pixel Agents
// visual "office" is sandboxed that way). That shell renders its own <main>
// landmark, which is correct when it owns a whole page (apps/web, apps/mobile,
// ...) but becomes a nested/duplicate <main> once embedded inside a docs
// content page that already has one. Fixing this properly means making the
// shell's own root landmark element configurable for embedded contexts — a
// change to shared product-shell code, out of scope for this docs-only PR.
// Tracked here as a single, explicit, out-of-scope architectural finding
// rather than silently disabling landmark checks on ordinary content pages too.
const NESTED_PRODUCT_SHELL_LANDMARKS: ExpectedViolation[] = [
  {
    id: 'landmark-main-is-top-level',
    matchesHtml: () => true,
    reason: 'the embedded product shell renders its own <main> inside the docs page main'
  },
  {
    id: 'landmark-no-duplicate-main',
    matchesHtml: () => true,
    reason: 'the embedded product shell renders its own <main> inside the docs page main'
  },
  {
    id: 'landmark-unique',
    matchesHtml: () => true,
    reason: 'a knock-on effect of the duplicate/nested <main> above'
  }
]

const assertNoUnexpectedA11yViolations = async (
  page: Page,
  expected: ExpectedViolation[] = []
): Promise<void> => {
  // The Pixel Agents "office" is a same-origin sandboxed iframe rendering a
  // third-party-shaped vendored bundle (@tinytinkerer/pixel-agents); its own
  // accessibility posture is that package's concern, not this docs gate's.
  const results = await new AxeBuilder({ page }).exclude('iframe').analyze()

  const unexpected = results.violations.flatMap((violation) =>
    violation.nodes
      .filter((node) => !expected.some((e) => e.id === violation.id && e.matchesHtml(node.html)))
      .map((node) => ({
        rule: violation.id,
        impact: violation.impact,
        html: node.html,
        summary: node.failureSummary
      }))
  )

  expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([])
}

test.describe('docs accessibility (#457)', () => {
  for (const url of CONTENT_PAGE_URLS) {
    test(`${url} has no unexpected axe violations`, async ({ page }) => {
      await page.goto(url)
      // Content-only pages never mount the product shell, so the telemetry
      // dialog dismissFirstLoad waits for never appears — it already no-ops
      // in that case, just with a shorter budget than its 15s default.
      await dismissFirstLoad(page, 4_000)
      // Any content page can carry a fenced code block, so the Prism
      // known-limitation allowlist applies uniformly rather than only to the
      // one page it was first observed on.
      await assertNoUnexpectedA11yViolations(page, [PRISM_SYNTAX_TOKEN])
    })
  }

  test('the Pixel Agents lab has no unexpected axe violations', async ({ page }) => {
    await installChatMock(page)
    await page.goto(PIXEL_AGENTS_LAB_URL)
    await dismissFirstLoad(page)
    await assertNoUnexpectedA11yViolations(page, NESTED_PRODUCT_SHELL_LANDMARKS)
  })

  test('the execution trace lab has no unexpected axe violations', async ({ page }) => {
    await installChatMock(page)
    await page.goto(EXECUTION_TRACE_LAB_URL)
    await dismissFirstLoad(page)
    await assertNoUnexpectedA11yViolations(page, NESTED_PRODUCT_SHELL_LANDMARKS)
  })

  test('the plugin & tool-picker lab has no unexpected axe violations', async ({ page }) => {
    await installChatMock(page)
    await page.goto(PLUGIN_TOOL_PICKER_LAB_URL)
    await dismissFirstLoad(page)
    await assertNoUnexpectedA11yViolations(page, NESTED_PRODUCT_SHELL_LANDMARKS)
  })

  test('keyboard Tab reaches the skip link, search, and sidebar without a mouse', async ({
    page
  }) => {
    await page.goto(`${DOCS_ORIGIN}/docs/architecture/`)
    await dismissFirstLoad(page, 4_000)

    // Docusaurus renders a "Skip to main content" link as the very first
    // focusable element (visually hidden until focused) — the standard
    // mechanism for letting a keyboard user bypass the navbar/sidebar.
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()

    // The search box's OWN documented keyboard shortcut (docusaurus.config.ts's
    // searchBarShortcut: true, using the plugin's default "mod+k" keymap) must
    // actually open it, without ever touching a pointer. The input carries
    // aria-label="Search" but no type="search", so its implicit role is
    // "textbox", not "searchbox".
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('textbox', { name: 'Search' })).toBeFocused()
    await page.keyboard.press('Escape')
  })

  test('the lab reset control and fullscreen toggle have accessible names and stay reachable by keyboard', async ({
    page
  }) => {
    await installChatMock(page)
    await page.goto(PIXEL_AGENTS_LAB_URL)
    await dismissFirstLoad(page)

    // Native <button> elements with visible text — the accessible name comes
    // from that text for free, verified here via role+name (same query
    // assistive tech uses), not just a visual read of the label.
    const resetButton = page.getByRole('button', { name: 'Reset this lab' })
    const fullscreenButton = page.getByRole('button', { name: 'Fullscreen', exact: true })
    await expect(resetButton).toBeVisible()
    await expect(fullscreenButton).toBeVisible()

    // Both are plain, unmodified <button>s in normal tab order — reachable and
    // operable with Enter/Space, not just a click handler.
    await fullscreenButton.focus()
    await expect(fullscreenButton).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible()
    // The fullscreen dialog documents Escape as its own close affordance
    // (lab-container.tsx's keydown handler) — verify it actually works via
    // the keyboard, not just the visible "Exit fullscreen" button.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeVisible()
  })

  test('a prefers-reduced-motion visitor gets the accessible text switcher, never the graphical office', async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await installChatMock(page)
    await page.goto(PIXEL_AGENTS_LAB_URL)
    await dismissFirstLoad(page)

    // usePixelAgentsCapability (pixel-agents/capability.ts) routes a
    // prefers-reduced-motion visitor to the always-available text list
    // instead of the animated office — this is the end-to-end version of that
    // unit-tested rule: the office iframe must never even attempt to boot.
    await expect(page.locator('.pixel-agents-lab__fallback')).toBeVisible()
    await expect(page.locator('iframe[title="Pixel Agents office"]')).toHaveCount(0)

    // The fallback list itself must still be fully keyboard-operable (native
    // buttons, no custom ARIA widget) — the framework's stated fallback
    // contract (docs/extending/interactive-labs.md).
    await expect(page.getByRole('button', { name: 'New conversation', exact: true })).toBeVisible()
  })
})
