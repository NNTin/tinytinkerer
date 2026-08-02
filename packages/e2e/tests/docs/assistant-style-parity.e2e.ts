import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  dismissFirstLoad,
  dismissTelemetryDialog,
  requireShellPort
} from '../../fixtures/first-load'
import { installChatMock } from '../../fixtures/mock-litellm'

/**
 * Computed-style parity between the assistant embedded in the documentation and
 * the same component on its own origin (issue #480 re-review, finding 1).
 *
 * The documentation site deliberately does not import Tailwind's preflight — it
 * would fight Infima across every page — so the product's controls need that
 * baseline supplied some other way. When the documentation supplied it itself,
 * with selectors of its own, those selectors outranked the utility classes the
 * real components render with: the same suggestion button was a bordered control
 * on `/widget` and bulleted plain text on `/docs/`. The baseline now ships from
 * `@tinytinkerer/app-browser/embed.css` — generated from the pinned Tailwind
 * preflight, at the specificity real preflight has — and this is what holds it
 * there at runtime, where the host's postcss pipeline has had its say.
 *
 * The launcher hand-off below covers the other half of the same problem: two
 * renderers of one control, which must be indistinguishable across the moment
 * one replaces the other.
 *
 * COLOURS are deliberately not compared. The documentation legitimately themes
 * the surface — it has a dark mode, and `/widget` does not — and that is the one
 * thing a host is supposed to decide. What must match is the chrome the product
 * owns: whether there is a border at all, how much padding, whether the list has
 * bullets.
 */

const DOCS_ORIGIN = `http://localhost:${requireShellPort('E2E_PORT')}`
const WIDGET_URL = `http://localhost:${requireShellPort('E2E_PORT_WIDGET')}/widget/`

// Structure and spacing, not palette. Each of these was measurably different
// between the two origins before the embed baseline moved into app-browser.
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

/** The empty state's first click-to-fill suggestion, in the floating body. */
const suggestion = (page: Page) => page.locator('.widget-floating-shell ul > li > button').first()
const suggestionList = (page: Page) => page.locator('.widget-floating-shell ul').first()

test.describe('assistant style parity between /docs/ and /widget/ (#480)', () => {
  test('the empty-state suggestion has the same chrome on both origins', async ({ browser }) => {
    const docsPage = await browser.newPage()
    await installChatMock(docsPage)
    await docsPage.goto(`${DOCS_ORIGIN}/docs/architecture/`)
    await dismissTelemetryDialog(docsPage)
    await docsPage.getByRole('button', { name: /documentation assistant/i }).click()
    await expect(suggestion(docsPage)).toBeVisible({ timeout: 30_000 })

    const widgetPage = await browser.newPage()
    await installChatMock(widgetPage)
    await widgetPage.goto(WIDGET_URL)
    await dismissFirstLoad(widgetPage)
    await expect(suggestion(widgetPage)).toBeVisible({ timeout: 30_000 })

    expect(await computed(suggestion(docsPage), CHROME_PROPERTIES)).toEqual(
      await computed(suggestion(widgetPage), CHROME_PROPERTIES)
    )

    // The list itself: Infima and the UA both give a `<ul>` bullets and indent,
    // and only the embed baseline takes them away.
    expect(await computed(suggestionList(docsPage), ['list-style-type', 'padding-left'])).toEqual(
      await computed(suggestionList(widgetPage), ['list-style-type', 'padding-left'])
    )

    await docsPage.close()
    await widgetPage.close()
  })

  test('the suggestion is a real bordered control, not bulleted text', async ({ page }) => {
    // The failure this closes was silent: every axe and contrast check passed
    // while the control rendered as plain text, because plain text is perfectly
    // accessible. So this asserts the shape directly.
    await installChatMock(page)
    await page.goto(`${DOCS_ORIGIN}/docs/architecture/`)
    await dismissTelemetryDialog(page)
    await page.getByRole('button', { name: /documentation assistant/i }).click()

    const button = suggestion(page)
    await expect(button).toBeVisible({ timeout: 30_000 })

    const style = await computed(button, ['border-top-width', 'border-top-style', 'padding-left'])
    expect(style['border-top-style']).not.toBe('none')
    expect(parseFloat(style['border-top-width'] ?? '0')).toBeGreaterThan(0)
    expect(parseFloat(style['padding-left'] ?? '0')).toBeGreaterThan(0)

    expect((await computed(suggestionList(page), ['list-style-type']))['list-style-type']).toBe(
      'none'
    )
  })

  test('the cold launcher and the mounted one are the same control', async ({ page }) => {
    // Two renderers, one primitive (`tt-embed-launcher`). They hand off to each
    // other mid-interaction: the reader presses the cold button, the runtime
    // boots, and `FloatingLayout`'s launcher takes its place. When the geometry
    // was spelled twice — once in a stylesheet, once in a Tailwind class string —
    // nothing compared them, and the claim that they could not drift was simply
    // untrue. This compares them.
    await installChatMock(page)
    await page.goto(`${DOCS_ORIGIN}/docs/architecture/`)
    await dismissTelemetryDialog(page)

    const CHROME = [
      'width',
      'height',
      'border-top-width',
      'border-top-style',
      'border-radius',
      'background-color',
      'box-shadow',
      'display',
      'align-items',
      'justify-content'
    ] as const

    const cold = page.locator('.docs-assistant-launcher')
    await expect(cold).toBeVisible()
    const coldChrome = await computed(cold, CHROME)
    const coldBox = await cold.boundingBox()

    // Activate, wait for the real widget, then collapse it back to its launcher.
    await cold.click()
    await expect(page.locator('.widget-floating-shell')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Minimize widget' }).click()

    const mounted = page.locator('.widget-launcher')
    await expect(mounted).toBeVisible()

    expect(await computed(mounted, CHROME)).toEqual(coldChrome)
    // Size, not position: the mounted launcher lives inside a draggable shell
    // and the cold one is pinned to the corner, which is the host's business.
    const mountedBox = await mounted.boundingBox()
    expect(mountedBox?.width).toBe(coldBox?.width)
    expect(mountedBox?.height).toBe(coldBox?.height)
  })
})
