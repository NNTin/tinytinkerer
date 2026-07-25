import { lazy, Suspense } from 'react'
import { LabReset } from '../LabReset'
import { LiveLab } from '../LiveLab'
import { LiveSessionGate } from '../LiveSessionGate'

// Deferred behind its own lazy import (in addition to <LiveLab>'s own
// BrowserOnly + lazy client-runtime boundary): this module is what actually
// imports @tinytinkerer/pixel-agents and @tinytinkerer/app-browser's chat
// runtime. ExecutionTraceLab itself is registered globally in
// MDXComponents.tsx (imported eagerly by every docs page), so keeping ITS
// module scope light is what keeps a page with no <ExecutionTraceLab> from
// ever downloading either.
const ExecutionTraceLabContent = lazy(() =>
  import('./ExecutionTraceLabContent').then((mod) => ({ default: mod.ExecutionTraceLabContent }))
)

export type ExecutionTraceLabProps = {
  title?: string
}

const ExecutionTraceLabFallback = (): React.JSX.Element => (
  <p role="status">Preparing the execution trace lab…</p>
)

// The ready-made "live agent execution trace" lab (issue #454): drop
// `<ExecutionTraceLab />` into any .mdx page to get an isolated, single- or
// multi-conversation demo where a visitor's own prompt runs through the real
// docs-isolated runtime and every request/plan/tool/error/synthesis event
// renders as an ordered, expandable trace alongside the Pixel Agents office.
export const ExecutionTraceLab = ({
  title = 'Live agent execution trace lab'
}: ExecutionTraceLabProps): React.JSX.Element => (
  <LiveLab title={title}>
    <LiveSessionGate>
      <Suspense fallback={<ExecutionTraceLabFallback />}>
        <ExecutionTraceLabContent />
      </Suspense>
    </LiveSessionGate>
    <LabReset />
  </LiveLab>
)
