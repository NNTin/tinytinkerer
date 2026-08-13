/**
 * Where the Pixel Agents Office lives in the documentation sidebar (issue #472).
 *
 * This module is LIGHT and must stay that way. It is rendered from a swizzled
 * `@theme/DocSidebar/Desktop/Content`, which every documentation page loads, so
 * a `@tinytinkerer/app-browser` or `@tinytinkerer/pixel-agents` import anywhere
 * on this path would put the product runtime in every page's initial HTML —
 * exactly what `scripts/check-docs-performance-budget.mjs` fails the build for.
 * It therefore renders no Office of its own. It registers a DOM *target*; the
 * Office itself (`assistant-office.tsx`) lives in the runtime chunk and is
 * portaled in by the assistant host once the reader asks for it.
 *
 * Three states, and the reason for each:
 *
 * - **`idle`** — nothing has been downloaded. A button, and the honest cost in
 *   its label. Pressing it calls `activate()`, the same request the floating
 *   launcher makes; #479's activation store is idempotent, so the two cannot
 *   fight, and the presentation store deliberately keeps the panel's own
 *   minimized state out of it (the Office opening the runtime while the reader
 *   left the widget minimized is the case that store was designed around).
 * - **`starting`** — the target exists and is empty, at its final height, so
 *   nothing on the page moves when the room arrives.
 * - **`error`** — a retry, on the control that failed. `activate()` starts a
 *   fresh attempt rather than replaying a memoised rejection.
 *
 * Collapsing clears the target, which unmounts the Office and stops its iframe
 * — the space and cost control, not a `display: none`.
 */
import { useCallback, type ReactNode } from 'react'
import { useDocsAssistantRuntime } from './assistant-activation'
import { DOCS_ASSISTANT_OFFICE_SURFACE_ID } from './assistant-constants'
import { setDocsAssistantSurfaceTarget } from './assistant-surface'
import { setDocsAssistantOfficeCollapsed, useDocsAssistantOfficeCollapsed } from './office-collapse'

const REGION_ID = 'docs-assistant-office-region'

export const DocsAssistantOfficeSidebarSlot = (): ReactNode => {
  const { status, activate } = useDocsAssistantRuntime()
  const collapsed = useDocsAssistantOfficeCollapsed()

  // React calls a callback ref with the element on attach and with `null` on
  // detach, which is exactly the registry's contract — so unmounting the slot,
  // navigating to a route with no sidebar, or collapsing all withdraw the
  // target through this one function.
  const targetRef = useCallback((element: HTMLDivElement | null) => {
    setDocsAssistantSurfaceTarget(DOCS_ASSISTANT_OFFICE_SURFACE_ID, element)
  }, [])

  const started = status === 'starting' || status === 'ready'
  const expanded = started && !collapsed

  // Expanding always asks for the runtime too. A reader who collapsed the slot
  // last visit comes back to `idle` — the preference survived, the runtime did
  // not — and a "Show" that only un-collapsed would leave them looking at an
  // empty box waiting for a second press. `activate()` is idempotent while
  // starting or ready, so this costs nothing in the other direction.
  const expand = (): void => {
    setDocsAssistantOfficeCollapsed(false)
    activate()
  }

  return (
    <section className="docs-assistant-office-slot" aria-label="Agent office">
      <div className="docs-assistant-office-slot__header">
        <span className="docs-assistant-office-slot__title">Agent office</span>
        {started || collapsed ? (
          <button
            type="button"
            className="docs-assistant-office-slot__toggle"
            aria-expanded={expanded}
            aria-controls={REGION_ID}
            onClick={() => (expanded ? setDocsAssistantOfficeCollapsed(true) : expand())}
          >
            {expanded ? 'Hide' : 'Show'}
          </button>
        ) : null}
      </div>

      {started || collapsed ? null : (
        <button type="button" className="docs-assistant-office-slot__activate" onClick={expand}>
          {status === 'error'
            ? 'The agent office failed to start. Try again'
            : 'Show your assistant conversations'}
        </button>
      )}

      {expanded ? (
        <div className="docs-assistant-office-slot__stage" id={REGION_ID}>
          {status === 'starting' ? (
            <p role="status" className="docs-assistant-office-slot__stage-status">
              Opening the agent office…
            </p>
          ) : null}
          {/* The portal target. Empty by design — everything drawn here is a
              logical child of the assistant session, mounted by the runtime
              host somewhere else entirely in the React tree. */}
          <div className="docs-assistant-office-slot__target" ref={targetRef} />
        </div>
      ) : null}
    </section>
  )
}
