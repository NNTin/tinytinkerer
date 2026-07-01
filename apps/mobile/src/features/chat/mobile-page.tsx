import { ChatApp } from '@tinytinkerer/app-browser'
import { MobileChatLoading, MobilePanelLoading } from '../../app/loading-screen'
import { MobileInstallBanner } from '../install/mobile-install-banner'

// The mobile shell is a thin wrapper over the shared ChatApp in its docked layout,
// `mobile` size variant (full-viewport, safe-area padding, pill controls). The only
// mobile-specific piece is the PWA install banner, injected as a slot.
export const MobilePage = () => (
  <ChatApp
    mode="sidebar"
    morphable={false}
    sizeVariant="mobile"
    storageKey="tinytinkerer:mobile-layout:v1"
    LoadingComponent={MobileChatLoading}
    settingsFallback={<MobilePanelLoading />}
    installSlot={<MobileInstallBanner />}
  />
)
