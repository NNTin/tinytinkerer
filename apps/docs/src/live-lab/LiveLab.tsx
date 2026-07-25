import { lazy, Suspense, type ReactNode } from 'react'
import BrowserOnly from '@docusaurus/BrowserOnly'
import LabContainer from '../components/lab-container'
import { DOCS_LAB_NETWORK_NOTICE } from './constants'

// The only place this framework reaches for the heavy product runtime. Docusaurus's
// <BrowserOnly> renders nothing at all during static rendering/prerendering (issue
// #451 acceptance: "static builds do not access window, IndexedDB, auth state, or
// the network") and only invokes its render-prop after the client mounts; nesting a
// React.lazy import inside that means the chunk is only ever fetched once a page
// that actually contains a <LiveLab> renders it client-side.
const ClientRuntime = lazy(() => import('./client-runtime'))

export type LiveLabProps = {
  title?: string
  children: ReactNode
}

const LiveLabFallback = () => <p role="status">Preparing the live lab session…</p>

// Wrapped in the same `LabContainer` shell docs/index.mdx's preview shows
// (responsive/fullscreen chrome) — every real lab built on this framework
// (PixelAgentsLab, ExecutionTraceLab, PluginToolPickerLab) had been rendering
// its own bespoke box instead, so none of them ever got the fullscreen
// treatment the docs promise ("every one of them renders inside this shared
// container... fullscreen treatment is consistent across labs from day one").
// `status="ready"` unconditionally: LiveSessionGate/ClientRuntime already
// render their own finer-grained loading/error states as `children` here,
// same as the product's own equivalent surfaces would.
export const LiveLab = ({ title, children }: LiveLabProps) => (
  <div data-live-lab="">
    <LabContainer title={title ?? 'Live lab'} status="ready">
      {/* Always visible before any protected content (and therefore before any
          possible network action) can render — issue #451: "explain before each
          network action that it contacts the live backend and may consume quota." */}
      <p className="live-lab__notice">{DOCS_LAB_NETWORK_NOTICE}</p>
      <BrowserOnly fallback={<LiveLabFallback />}>
        {() => (
          <Suspense fallback={<LiveLabFallback />}>
            <ClientRuntime>{children}</ClientRuntime>
          </Suspense>
        )}
      </BrowserOnly>
    </LabContainer>
  </div>
)
