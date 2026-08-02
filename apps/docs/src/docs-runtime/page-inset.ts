/**
 * Publishes how much room the docked assistant is taking, as CSS custom
 * properties on `<html>` (issue #480 re-review, finding 2).
 *
 * The consumer is `.docs-assistant-page`, the stable wrapper `@theme/Root` puts
 * around the documentation. Custom properties rather than React state on purpose:
 * the wrapper is an ancestor of every live lab on the page, and threading a
 * measured pixel value through it as state would re-render that whole subtree on
 * every frame of a panel resize. A custom property changes one computed style and
 * touches no component.
 *
 * All four are written every time, so undocking clears the previous edge rather
 * than leaving the page indented against an assistant that is no longer there.
 */
import type { DockedPanelMetrics } from '@tinytinkerer/app-browser'

const EDGES = ['top', 'right', 'bottom', 'left'] as const

export const publishDocsAssistantPageInset = (metrics: DockedPanelMetrics): void => {
  const { style } = document.documentElement
  for (const edge of EDGES) {
    const size = metrics?.edge === edge ? metrics.size : 0
    style.setProperty(`--docs-assistant-inset-${edge}`, `${size}px`)
  }
}

/** Removes every property this module set. Used when the widget unmounts. */
export const clearDocsAssistantPageInset = (): void => {
  const { style } = document.documentElement
  for (const edge of EDGES) {
    style.removeProperty(`--docs-assistant-inset-${edge}`)
  }
}
