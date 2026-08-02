/**
 * The stable wrapper the whole documentation page renders inside (issue #480
 * re-review, finding 2).
 *
 * When the assistant is docked, the page has to make room for it — the same job
 * `@tinytinkerer/app-shell`'s `AppStageShell` does for `/ide`, where the docked
 * panel insets the stage rather than covering it. On a documentation site the
 * "stage" is the page itself, so the inset lands here.
 *
 * Three properties matter, and all three are why this is a plain element rendered
 * unconditionally rather than something the host mounts when docking begins:
 *
 * 1. **It never remounts.** It is present from the very first render, in every
 *    mode, so docking and undocking change padding and nothing else. A wrapper
 *    that appeared on dock would remount the entire page subtree — every live lab
 *    on it, mid-session.
 * 2. **It is not an ancestor of the assistant.** `@theme/Root` keeps the runtime
 *    host a SIBLING of this (issue #479): `BrowserAppShell` renders a boot screen
 *    in place of its children, so hosting the documentation inside it would blank
 *    the page while the assistant booted.
 * 3. **It carries no state.** The measured geometry arrives as CSS custom
 *    properties on `<html>`, written by the runtime host from
 *    `useDockedPanelMetrics`. Passing it as React state would mean the page
 *    subtree re-rendered on every frame of a panel resize.
 *
 * The padding itself is in custom.css (`.docs-assistant-page`); this file exists
 * so the element has one documented owner rather than being an anonymous div in
 * `Root`.
 */
import type { ReactNode } from 'react'

export const DocsAssistantPageRegion = ({ children }: { children: ReactNode }): ReactNode => (
  <div className="docs-assistant-page">{children}</div>
)
