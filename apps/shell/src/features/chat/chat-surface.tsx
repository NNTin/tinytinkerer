import { ChatApp, ContextInspectorSlot } from '@tinytinkerer/app-browser'
import { FaReceipt } from '@tinytinkerer/ui'
import type { ShellPresentation } from '../../presentations'
import { resolveWidgetWindowMode } from '../../runtime-config'
import { MobileInstallBanner } from '../install/mobile-install-banner'

// The one chat surface, configured from the resolved presentation descriptor. This
// is the lazy route chunk: the shared ChatApp (both layout shells + bodies) plus the
// presentation-specific slots (inspector viewer / install banner, which pull in
// @tinytinkerer/ui + heroicons) live here, off the entry graph. The widget↔sidebar
// morph, send/stop, and settings all live inside the shared ChatApp.
export const ShellChatPage = ({ presentation }: { presentation: ShellPresentation }) => {
  const { PanelLoading } = presentation

  return (
    <ChatApp
      mode={presentation.mode}
      {...(presentation.morphable === false ? { morphable: false } : {})}
      {...(presentation.sizeVariant ? { sizeVariant: presentation.sizeVariant } : {})}
      storageKey={presentation.storageKey}
      LoadingComponent={presentation.ChatLoading}
      {...(PanelLoading ? { settingsFallback: <PanelLoading /> } : {})}
      {...(presentation.id === 'widget'
        ? { initialMinimized: resolveWidgetWindowMode(window.location.search) === 'minimized' }
        : {})}
      {...(presentation.supportsInspector
        ? {
            inspectorPanelSupported: true,
            inspectorSlot: (
              <ContextInspectorSlot icon={<FaReceipt className="h-4 w-4" aria-hidden="true" />} />
            )
          }
        : {})}
      {...(presentation.supportsInstall ? { installSlot: <MobileInstallBanner /> } : {})}
    />
  )
}
