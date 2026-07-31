import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react'
import BrowserOnly from '@docusaurus/BrowserOnly'
import {
  publishDocsAssistantRuntimeStatus,
  useDocsAssistantRuntimeStatus
} from './assistant-activation'

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

const AssistantRuntimeClient = lazy(() => import('./assistant-runtime-client'))

type BoundaryProps = { children: ReactNode }
type BoundaryState = { failed: boolean }

// Scoped to the assistant subtree. Docusaurus has its own error handling for the
// page; this one exists so a broken assistant chunk can never reach it.
class AssistantErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced in the console rather than on the page: #479 ships no visible
    // assistant surface, and the status below is what a launcher (#480) reads.
    console.error('The documentation assistant failed to start.', error, info.componentStack)
    publishDocsAssistantRuntimeStatus('error')
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

export const DocsAssistantRuntimeHost = (): ReactNode => {
  const status = useDocsAssistantRuntimeStatus()

  // Nothing has asked for the assistant yet: no chunk, no session, no session
  // storage touched. `error` also renders nothing — `activate()` moves it back
  // to `starting`, which remounts the subtree and retries the import.
  if (status === 'idle' || status === 'error') {
    return null
  }

  return (
    <AssistantErrorBoundary>
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
