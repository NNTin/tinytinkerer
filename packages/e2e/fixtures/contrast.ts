import type { Page } from '@playwright/test'

/**
 * Real text contrast inside a subtree, resolved against the nearest ancestor
 * that actually paints a background.
 *
 * Written for `tests/docs/assistant-widget.e2e.ts` (issue #480 review, finding
 * 3), extracted here when #496 needed the same sweep over a live lab. Extracted
 * rather than copied deliberately: the two `getComputedStyle` subtleties below
 * are exactly the kind of thing one copy gets right and the other quietly does
 * not, and the whole reason this helper exists is that a cruder version of it
 * passed while the surface it measured was illegible.
 *
 * Two things it gets right that a naive version does not:
 *
 * 1. **It walks up for the background.** Reading the outer frame's brightness —
 *    what the first version of the dark-mode test did — cannot see a near-black
 *    heading on a near-black panel: the panel was genuinely dark the whole time,
 *    and the text on it was near-black. Measured at 1.04:1.
 * 2. **It parses both colour serialisations.** Chromium reports a `color-mix()`
 *    result as `color(srgb r g b / a)` with 0–1 components and a plain colour as
 *    `rgb()`/`rgba()` with 0–255 ones. Reading the first as if it were the
 *    second is how an assertion once concluded a genuinely dark panel was light.
 * 3. **It skips `aria-hidden` subtrees** (issue #496).
 *
 *    Stated plainly: this is a **loosening** of a check that has been guarding
 *    the assistant since #480, not a bug fix. It was added because #496 pointed
 *    the sweep at a live lab and hit `@tinytinkerer/app-shell`'s dock drag
 *    handle — an `aria-hidden="true"` braille glyph (`⠿`,
 *    `dockable-panel-layout.tsx:443`) at 3.78:1 — so the decision was either
 *    this, or a per-surface scope exclusion.
 *
 *    The trade is worth taking on two grounds. WCAG 1.4.3 exempts decorative
 *    content, so the skipped nodes are outside what the sweep claims to measure;
 *    and axe, which runs beside this on the same surfaces, excludes them for
 *    that reason, so the two gates now agree instead of contradicting each other.
 *    The alternative was worse: a sweep that reds on a glyph no assistive
 *    technology announces trains people to widen its scope exclusions, and a
 *    widened scope stops measuring anything.
 *
 *    What it costs: text that is genuinely illegible AND marked `aria-hidden`
 *    now passes here. That is a real hole, and it is the reason this skip is
 *    narrow (`aria-hidden="true"` only, no `role="presentation"`, no opacity
 *    heuristic) rather than a general "decorative" filter.
 *
 * Returns the WORST ratio found, or 21 when the subtree has no visible text.
 */
export const worstContrastIn = async (page: Page, selector: string): Promise<number> =>
  page.evaluate((target) => {
    const parse = (value: string): [number, number, number] => {
      const parts = (value.match(/[\d.]+/g) ?? []).map(Number)
      const scale = value.startsWith('color(') ? 255 : 1
      return [(parts[0] ?? 0) * scale, (parts[1] ?? 0) * scale, (parts[2] ?? 0) * scale]
    }
    const opaque = (value: string): boolean => {
      if (!value || value === 'transparent') return false
      const alpha = value.startsWith('color(')
        ? Number((value.split('/')[1] ?? '1').replace(/[^\d.]/g, '') || 1)
        : Number((value.match(/[\d.]+/g) ?? [])[3] ?? 1)
      return alpha > 0.95
    }
    const luminance = ([r, g, b]: [number, number, number]): number => {
      const channel = (c: number): number => {
        const v = c / 255
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    const backgroundOf = (element: Element): [number, number, number] => {
      let node: Element | null = element
      while (node) {
        const { backgroundColor } = getComputedStyle(node)
        if (opaque(backgroundColor)) return parse(backgroundColor)
        node = node.parentElement
      }
      return [255, 255, 255]
    }

    let worst = 21
    for (const element of document.querySelectorAll(`${target} *`)) {
      const text = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? '')
        .join('')
      if (!text) continue
      // `closest`, not the element's own attribute: hiding a container hides
      // everything under it from assistive technology, so a ratio inside one is
      // not a ratio anybody reads.
      if (element.closest('[aria-hidden="true"]')) continue
      const style = getComputedStyle(element)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      const foreground = luminance(parse(style.color))
      const background = luminance(backgroundOf(element))
      const ratio =
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
      worst = Math.min(worst, ratio)
    }
    return worst
  }, selector)

/** WCAG AA for normal-size text. */
export const AA_NORMAL_TEXT = 4.5
