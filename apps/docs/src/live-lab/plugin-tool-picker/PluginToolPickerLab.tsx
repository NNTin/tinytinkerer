import { lazy, Suspense } from 'react'
import { LabReset } from '../LabReset'
import { LiveLab } from '../LiveLab'
import { LiveSessionGate } from '../LiveSessionGate'

// Deferred behind its own lazy import (in addition to <LiveLab>'s own
// BrowserOnly + lazy client-runtime boundary): this module is what actually
// imports @tinytinkerer/app-browser and @tinytinkerer/pixel-agents.
// PluginToolPickerLab itself is registered globally in MDXComponents.tsx
// (imported eagerly by every docs page), so keeping ITS module scope light is
// what keeps a page with no <PluginToolPickerLab> from ever downloading either.
const PluginToolPickerLabContent = lazy(() =>
  import('./PluginToolPickerLabContent').then((mod) => ({
    default: mod.PluginToolPickerLabContent
  }))
)

export type PluginToolPickerLabProps = {
  title?: string
}

const PluginToolPickerLabFallback = (): React.JSX.Element => (
  <p role="status">Preparing the plugin & tool-picker impact lab…</p>
)

// The ready-made "plugin and tool-picker impact lab" (issue #453): drop
// `<PluginToolPickerLab />` into any .mdx page to get an isolated, live demo of
// the REAL production tool-tree picker (useToolTree/ToolTreeSlot, unmodified)
// driving this docs app's own intrinsic demo tool group, backed by the docs
// session's own chat store — with an always-available accessible text
// explanation (the inline tool list) alongside the Pixel Agents visualization.
export const PluginToolPickerLab = ({
  title = 'Plugin & tool-picker impact lab'
}: PluginToolPickerLabProps): React.JSX.Element => (
  <LiveLab title={title}>
    <LiveSessionGate>
      <Suspense fallback={<PluginToolPickerLabFallback />}>
        <PluginToolPickerLabContent />
      </Suspense>
    </LiveSessionGate>
    <LabReset />
  </LiveLab>
)
