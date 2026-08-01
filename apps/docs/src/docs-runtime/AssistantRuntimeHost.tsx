import { Component, lazy, Suspense, useMemo, type ErrorInfo, type ReactNode } from 'react'
import BrowserOnly from '@docusaurus/BrowserOnly'
import {
  publishDocsAssistantRuntimeStatus,
  useDocsAssistantRuntimeActivation
} from './assistant-activation'
import { importAssistantRuntimeClient } from './assistant-runtime-loader'

// The documentation assistant's runtime host (issue #479), mounted from
// @theme/Root as a SIBLING of the Docusaurus page subtree.
//
// Sibling, not ancestor, and the reason is structural: BrowserAppShell renders
// its boot screen INSTEAD of its children and wraps them in StrictMode and an
// error boundary. As an ancestor it would blank the documentation while the
// assistant booted, double-render the whole site, and let an assistant error
// take a documentation page down with it. As a sibling it can fail entirely and
// the page is unaffected — which is also why this file adds an error boundary of
// its own around the lazy subtree.
//
// This module stays LIGHT. It is imported by @theme/Root, which every
// documentation page loads, so a static import of @tinytinkerer/app-browser
// here would put the product runtime in every page's initial HTML — the thing
// scripts/check-docs-performance-budget.mjs exists to prevent. The runtime is
// reached through React.lazy behind <BrowserOnly> AND behind an explicit
// activation, so the chunk is fetched when a reader first asks for the
// assistant, not when they open a documentation page.

type BoundaryProps = { children: ReactNode; onError: () => void }
type BoundaryState = { failed: boolean }

// Scoped to the assistant subtree, and to ONE attempt: `key`ed on the attempt
// number by its parent, so a retry mounts a fresh boundary rather than one that
// has already latched `failed`. Docusaurus has its own error handling for the
// page; this exists so a broken assistant chunk never reaches it.
class AssistantErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced in the console rather than on the page: #479 ships no visible
    // assistant surface, and the status is what a launcher (#480) reads.
    console.error('The documentation assistant failed to start.', error, info.componentStack)
    this.props.onError()
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

export const DocsAssistantRuntimeHost = (): ReactNode => {
  const { status, attempt } = useDocsAssistantRuntimeActivation()

  // A fresh payload per attempt. `React.lazy` memoises BOTH outcomes on the
  // payload object, so reusing one module-level `lazy(...)` would make every
  // retry rethrow the first rejection without ever calling `import()` again —
  // a status that advertises a retry it cannot perform. Keyed identically on the
  // subtree below, so the new payload actually gets mounted.
  // `attempt` is the whole dependency: nothing else the memo closes over can
  // change, and a new attempt must produce a new payload.
  const AssistantRuntimeClient = useMemo(() => lazy(importAssistantRuntimeClient), [attempt])

  // Nothing has asked for the assistant yet: no chunk, no session, no session
  // storage touched. `error` also renders nothing — `activate()` moves it back
  // to `starting` with a new attempt, which remounts the subtree below and
  // re-runs the import.
  if (status === 'idle' || status === 'error') {
    return null
  }

  return (
    <AssistantErrorBoundary
      key={attempt}
      onError={() => publishDocsAssistantRuntimeStatus('error')}
    >
      <BrowserOnly>
        {() => (
          <Suspense fallback={null}>
            <AssistantRuntimeClient />
          </Suspense>
        )}
      </BrowserOnly>
    </AssistantErrorBoundary>
  )
}
