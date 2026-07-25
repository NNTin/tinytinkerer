import { lazy, Suspense } from 'react'
import { LabReset } from '../LabReset'
import { LiveLab } from '../LiveLab'
import { LiveSessionGate } from '../LiveSessionGate'

// Deferred behind its own lazy import (in addition to <LiveLab>'s own
// BrowserOnly + lazy client-runtime boundary): this module is what actually
// imports @tinytinkerer/pixel-agents and @tinytinkerer/app-browser's chat
// runtime. PixelAgentsLab itself is registered globally in MDXComponents.tsx
// (imported eagerly by every docs page), so keeping ITS module scope light
// is what keeps a page with no <PixelAgentsLab> from ever downloading either.
const PixelAgentsLabContent = lazy(() =>
  import('./PixelAgentsLabContent').then((mod) => ({ default: mod.PixelAgentsLabContent }))
)

export type PixelAgentsLabProps = {
  title?: string
}

const PixelAgentsLabFallback = (): React.JSX.Element => (
  <p role="status">Preparing the Pixel Agents lab…</p>
)

// The ready-made "Pixel Agents as the conversation-management surface" lab
// (issue #452): drop `<PixelAgentsLab />` into any .mdx page to get an
// isolated, multi-conversation demo backed by the docs session's own chat
// store, with an always-available accessible text fallback (see
// ConversationSwitcher.tsx) when the graphical office can't or shouldn't run.
export const PixelAgentsLab = ({
  title = 'Pixel Agents live conversation lab'
}: PixelAgentsLabProps): React.JSX.Element => (
  <LiveLab title={title}>
    <LiveSessionGate>
      <Suspense fallback={<PixelAgentsLabFallback />}>
        <PixelAgentsLabContent />
      </Suspense>
    </LiveSessionGate>
    <LabReset />
  </LiveLab>
)
