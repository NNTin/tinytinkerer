import { ChatApp } from '@tinytinkerer/app-browser'
import type { ShellPresentation } from '../../presentations'
import { resolveWidgetWindowMode } from '../../runtime-config'
import { MobileInstallBanner } from '../install/mobile-install-banner'

// The one chat surface, configured from the resolved presentation descriptor. This
// is the lazy route chunk: the shared ChatApp (both layout shells + bodies, which
// render their own context-inspector viewer button when a shell opts in) plus the
// presentation-specific install banner (which pulls in @tinytinkerer/ui + heroicons)
// live here, off the entry graph. The widget↔sidebar morph, send/stop, and settings
// all live inside the shared ChatApp.
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
      {...(presentation.supportsInspector ? { inspectorPanelSupported: true } : {})}
      {...(presentation.supportsInstall ? { installSlot: <MobileInstallBanner /> } : {})}
    />
  )
}
