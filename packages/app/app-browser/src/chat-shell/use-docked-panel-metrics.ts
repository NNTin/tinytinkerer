import { useEffect, useRef, useState, type RefObject } from 'react'
import type { SnapEdge } from './layout-geometry'

/**
 * Which viewport edge a `ChatApp` is docked to, and how much room its panel takes
 * — or `null` while it is floating.
 *
 * A host that composes a stage beside the assistant has to inset that stage by
 * exactly this much, and has to keep doing so as the panel is resized, re-docked
 * or undocked. Extracted from `@tinytinkerer/app-shell`'s `AppStageShell` (issue
 * #480 re-review, finding 2) so the documentation site insets its page from the
 * same measurement rather than growing a second copy of it.
 *
 * Measurement rather than state on purpose: `SidebarLayout` owns the panel's size
 * and persists it, and the panel's real geometry is the only thing that accounts
 * for a drag in progress, a viewport clamp, or the layout's own defaults.
 *
 * A `MutationObserver` on `style`/`data-edge` plus a window `resize` listener is
 * what keeps it current; both are the attributes `SidebarLayout` actually writes.
 * The value only changes when the measurement changes, so a host can use it as a
 * render dependency without looping.
 */
export type DockedPanelMetrics = { edge: SnapEdge; size: number } | null

const measurePanel = (panel: HTMLElement): DockedPanelMetrics => {
  const rect = panel.getBoundingClientRect()
  switch (panel.dataset['edge']) {
    case 'right':
      return { edge: 'right', size: Math.round(rect.width) }
    case 'left':
      return { edge: 'left', size: Math.round(rect.width) }
    case 'top':
      return { edge: 'top', size: Math.round(rect.height) }
    case 'bottom':
      return { edge: 'bottom', size: Math.round(rect.height) }
    default:
      return null
  }
}

const signature = (metrics: DockedPanelMetrics): string =>
  metrics ? `${metrics.edge}:${metrics.size}` : 'none'

export const useDockedPanelMetrics = (): {
  ref: RefObject<HTMLDivElement | null>
  metrics: DockedPanelMetrics
} => {
  const ref = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<DockedPanelMetrics>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    let last = signature(null)
    const measure = () => {
      const panel = root.querySelector<HTMLElement>('.sidebar-panel')
      const next = panel ? measurePanel(panel) : null
      const nextSignature = signature(next)
      if (nextSignature === last) return
      last = nextSignature
      setMetrics(next)
    }
    measure()
    const observer = new MutationObserver(measure)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'data-edge']
    })
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return { ref, metrics }
}
