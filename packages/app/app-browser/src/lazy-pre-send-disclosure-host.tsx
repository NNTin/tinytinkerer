import { lazy } from 'react'

// Lazy for the same reason its consent/privacy/Konami siblings are: every browser
// shell mounts this from `BrowserAppShell`, so a static import would put the
// dialog — and, through `PrivacyPolicyDialog`, the Markdown document renderer and
// the whole generated privacy policy — into every startup entry chunk. That
// measurably broke `apps/shell`'s 68 kB entry budget when it was written eagerly.
//
// The chunk still loads immediately after boot, long before any reader can type a
// message and press send, so nothing about the gate's timing depends on this.
export const LazyPreSendDisclosureHost = lazy(() =>
  import('./pre-send-disclosure-host').then((module) => ({
    default: module.PreSendDisclosureHost
  }))
)
