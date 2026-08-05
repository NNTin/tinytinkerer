import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { dismissFirstLoad, requireShellPort } from '../../fixtures/first-load'
import { installChatMock } from '../../fixtures/mock-litellm'
import {
  PIXEL_AGENTS_LAB_URL,
  PLUGIN_TOOL_PICKER_LAB_URL,
  RICH_CONTENT_PLAYGROUND_URL
} from '../../fixtures/docs-lab'
import { AA_NORMAL_TEXT, worstContrastIn } from '../../fixtures/contrast'

/**
 * The live labs follow the documentation's theme (issue #496).
 *
 * ## What was wrong
 *
 * A reader in dark mode got a dark assistant panel and a bright white lab on the
 * same page. Two independent causes, and the issue named only the second:
 *
 * 1. **The labs were painted in literal light neutrals.**
 *    `docked-chat-surface.tsx` carried 33 `stone-*`/`white` classes and
 *    `turn-activity-panel.tsx` 36 — composer, textarea, icon buttons, notices,
 *    activity cards, code frames. No palette can reach a literal, so supplying
 *    one would have half-themed the lab, which is worse than uniformly light.
 *    Both components now read the token graph.
 * 2. **No palette reached them anyway.** Nothing in the lab tree carried
 *    `tt-app-embed`, so it resolved tokens off `:root` — the light defaults
 *    `@tinytinkerer/app-browser/styles.css` installs — while `custom.css`
 *    declared the documentation's per-theme bases on `.docs-assistant-root`
 *    alone. The palette is now keyed on `tt-app-embed`, and `ChatApp`'s own
 *    stage element carries it: the product marks its own surface, because that
 *    is the element `shellThemeToCssVars` writes a host palette onto and the
 *    derived graph has to be declared where the bases are.
 *
 * ## Why this suite exists rather than an eyeball
 *
 * `accessibility.e2e.ts` already runs axe over all three labs, but never with
 * `emulateMedia({ colorScheme: 'dark' })` — so every lab assertion on this site
 * was a light-mode assertion, and the dark-mode defect could not have been
 * caught. The contrast sweep below is the same one
 * `assistant-widget.e2e.ts` runs over the assistant's dialogs
 * (`fixtures/contrast.ts`), pointed at a lab's product surface in BOTH themes.
 */
const WIDGET_URL = `http://localhost:${requireShellPort('E2E_PORT_WIDGET')}/widget/`

/**
 * A lab's PRODUCT subtree — which is `ChatApp`'s stage, the only element inside
 * a lab that carries the scope class. Verified by enumerating
 * `[data-live-lab] .tt-app-embed` on the built site: exactly one node,
 * `div.sidebar-stage.tt-app-embed`.
 *
 * Two things this selector is doing, both deliberate:
 *
 * - **`[data-live-lab]` prefix.** The assistant is mounted on every `/docs/`
 *   route and carries `.tt-app-embed` too, so the bare class would match it as
 *   well and this suite would silently be re-testing the assistant.
 * - **NOT the documentation's own in-lab chrome.** `ConversationSwitcher`, the
 *   tool-picker summary and the compare panel live inside a lab but outside this
 *   selector, on Infima tokens, and are deliberately untouched by this change.
 */
const LAB_SURFACE = '[data-live-lab] .tt-app-embed'

test.describe('live-lab theming (#496)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the live lab's product surface is legible in ${theme} mode`, async ({ page }) => {
      // Driven from the system preference rather than the navbar toggle, for the
      // reason `assistant-widget.e2e.ts` records: `respectPrefersColorScheme` is
      // on for this site, so this lands on the requested theme deterministically
      // while clicking a toggle only flips whatever the runner produced.
      await page.emulateMedia({ colorScheme: theme })
      await installChatMock(page)
      await page.goto(PLUGIN_TOOL_PICKER_LAB_URL)
      await dismissFirstLoad(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      // The composer is the part that was most visibly wrong — a white textarea
      // with stone borders on a near-black page — and it proves the surface has
      // actually mounted rather than the sweep passing over an empty subtree.
      await expect(page.locator(`${LAB_SURFACE} textarea[aria-label="Message"]`)).toBeVisible({
        timeout: 30_000
      })

      expect(await worstContrastIn(page, LAB_SURFACE)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
    })

    test(`the lab surface follows the site palette in ${theme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await installChatMock(page)
      await page.goto(PIXEL_AGENTS_LAB_URL)
      await dismissFirstLoad(page)

      await expect(page.locator(`${LAB_SURFACE} textarea[aria-label="Message"]`)).toBeVisible({
        timeout: 30_000
      })

      // The claim in one number: the lab's own conversation panel is dark on a
      // dark site and light on a light one. Reading `--panel` off the scope
      // rather than a component's background, because that is the token the
      // documentation supplies and everything else derives from — and because a
      // component background could be correct for an accidental reason.
      const panel = await page
        .locator(LAB_SURFACE)
        .first()
        .evaluate((element) => {
          const raw = getComputedStyle(element).getPropertyValue('--panel').trim()
          // Resolve through the UA rather than parsing hex here: `--panel` is a
          // plain hex today but the graph around it is `color-mix()`, and this
          // assertion should not care which.
          const probe = document.createElement('span')
          probe.style.color = raw
          element.appendChild(probe)
          const resolved = getComputedStyle(probe).color
          probe.remove()
          const parts = (resolved.match(/[\d.]+/g) ?? []).map(Number)
          const scale = resolved.startsWith('color(') ? 255 : 1
          const [r = 0, g = 0, b = 0] = parts
          return ((r + g + b) / 3) * scale
        })

      if (theme === 'dark') {
        expect(panel).toBeLessThan(128)
      } else {
        expect(panel).toBeGreaterThan(128)
      }
    })
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`the rich-content playground follows the site palette in ${theme} mode`, async ({
      page
    }) => {
      // The third embedded product surface, and the one the issue's scope did
      // not list. It was un-themed for the same reason the labs were, so leaving
      // it out would have reproduced the exact inconsistency #496 exists to
      // close — one of three surfaces still light beside two that follow the
      // theme.
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(RICH_CONTENT_PLAYGROUND_URL)
      await dismissFirstLoad(page, 4_000)

      const preview = page.locator('.rich-content-playground__preview .tt-app-embed')
      await expect(preview).toBeVisible({ timeout: 30_000 })

      // Asserts the DERIVED token, not a base. `--panel-hover` is a `color-mix()`
      // over `--panel`, and a custom property is computed where it is DECLARED —
      // so a graph reaching this element from `:root` would mix against `:root`'s
      // LIGHT panel and hand down a light value even here. Reading it back is the
      // only way to prove the graph resolved locally, which is the whole point of
      // `token-graph.css` declaring itself for this scope.
      const hover = await preview.evaluate((element) => {
        const probe = document.createElement('span')
        probe.style.color = getComputedStyle(element).getPropertyValue('--panel-hover').trim()
        element.appendChild(probe)
        const resolved = getComputedStyle(probe).color
        probe.remove()
        const parts = (resolved.match(/[\d.]+/g) ?? []).map(Number)
        const scale = resolved.startsWith('color(') ? 255 : 1
        const [r = 0, g = 0, b = 0] = parts
        return ((r + g + b) / 3) * scale
      })

      if (theme === 'dark') {
        expect(hover).toBeLessThan(128)
      } else {
        expect(hover).toBeGreaterThan(128)
      }
    })
  }

  test('the live lab has no unexpected axe violations in dark mode', async ({ page }) => {
    // `accessibility.e2e.ts` covers all three labs, but only in whatever theme
    // the runner defaults to — which is light. This is the missing half, and
    // colour-contrast is precisely the rule a dark mode regresses.
    await page.emulateMedia({ colorScheme: 'dark' })
    await installChatMock(page)
    await page.goto(PLUGIN_TOOL_PICKER_LAB_URL)
    await dismissFirstLoad(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    const results = await new AxeBuilder({ page })
      .include(LAB_SURFACE)
      .withRules(['color-contrast'])
      .analyze()
    expect(JSON.stringify(results.violations, null, 2)).toBe('[]')
  })
})

/**
 * The preflight delta the embed scope introduces (issue #496).
 *
 * Giving the labs `tt-app-embed` applies `@tinytinkerer/app-browser/embed.css`'s
 * generated, scoped Tailwind preflight to them — which they had never had, since
 * `apps/docs/src/css/tailwind.css` deliberately excludes preflight site-wide.
 * That is the one part of this change that is composition rather than colour, so
 * it is measured rather than asserted to be harmless: this compares the same
 * component's chrome between the lab and `/widget`, where real preflight is
 * global.
 *
 * Same shape and same property list as `assistant-style-parity.e2e.ts`, which
 * does this for the assistant. Colours are excluded there and here for the same
 * reason — the documentation legitimately themes the surface and has a dark mode
 * `/widget` does not. What must match is the chrome the product owns.
 */
const CHROME_PROPERTIES = [
  'border-top-style',
  'border-top-width',
  'border-bottom-width',
  'border-left-width',
  'border-radius',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'text-align',
  'font-size',
  'font-weight',
  'display',
  'cursor'
] as const

const computed = async (locator: Locator, properties: readonly string[]) =>
  locator.evaluate(
    (element, props: string[]) => {
      const style = window.getComputedStyle(element)
      return Object.fromEntries(
        props.map((property) => [property, style.getPropertyValue(property)])
      )
    },
    [...properties]
  )

/**
 * The empty state's first click-to-fill suggestion, inside the lab.
 *
 * Anchored on the product surface's own `<main>`. The bare
 * `${LAB_SURFACE} ul > li > button` matches `ConversationSwitcher` first —
 * documentation-authored chrome that lives INSIDE the embed scope (the scope
 * wraps the lab's whole product subtree, and a lab component mixes its own
 * Infima-styled controls with the embedded `ChatApp`). Comparing that against
 * `/widget` compares two different components and fails for a reason that has
 * nothing to do with preflight.
 */
const labSuggestion = (page: Page) => page.locator(`${LAB_SURFACE} main ul > li > button`).first()
const widgetSuggestion = (page: Page) =>
  page.locator('.widget-floating-shell ul > li > button').first()

test.describe('live-lab preflight parity with /widget (#496)', () => {
  test('the empty-state suggestion has the same chrome in a lab as on /widget', async ({
    browser
  }) => {
    const docsPage = await browser.newPage()
    await installChatMock(docsPage)
    await docsPage.goto(PLUGIN_TOOL_PICKER_LAB_URL)
    await dismissFirstLoad(docsPage)
    await expect(labSuggestion(docsPage)).toBeVisible({ timeout: 30_000 })

    const widgetPage = await browser.newPage()
    await installChatMock(widgetPage)
    await widgetPage.goto(WIDGET_URL)
    await dismissFirstLoad(widgetPage)
    await expect(widgetSuggestion(widgetPage)).toBeVisible({ timeout: 30_000 })

    expect(await computed(labSuggestion(docsPage), CHROME_PROPERTIES)).toEqual(
      await computed(widgetSuggestion(widgetPage), CHROME_PROPERTIES)
    )

    await docsPage.close()
    await widgetPage.close()
  })
})
