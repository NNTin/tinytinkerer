import { AppErrorBoundary, ChatApp } from '@tinytinkerer/app-browser'
import { RootChatLoading } from './loading-screen'

// The root `/` composition: all three shells at once, in ONE document, over ONE
// shared session (the surface stores live in the single AppBrowserProvider above
// this). The web + mobile panes render the shared docked layout; the widget pane
// floats over them and is morphable, so its dock button turns it into a sidebar and
// back — the same shared conversation the whole time. No iframes, no postMessage.
// Each pane gets its own error boundary so a render throw in one shell leaves the
// other two (and the shared session) alive.
export const RootComposition = () => (
  <div className="root-stage">
    <section className="root-pane root-pane-web" aria-label="Web shell">
      <p className="root-pane-label">Web</p>
      <div className="root-pane-body">
        <AppErrorBoundary label="root-pane-web">
          <ChatApp
            mode="sidebar"
            sizeVariant="comfortable"
            morphable={false}
            fill
            storageKey="tinytinkerer:root-web-layout"
            LoadingComponent={RootChatLoading}
          />
        </AppErrorBoundary>
      </div>
    </section>

    <section className="root-phone" aria-label="Mobile shell">
      <div className="root-phone-frame">
        <AppErrorBoundary label="root-pane-mobile">
          <ChatApp
            mode="sidebar"
            sizeVariant="mobile"
            morphable={false}
            fill
            storageKey="tinytinkerer:root-mobile-layout"
            LoadingComponent={RootChatLoading}
          />
        </AppErrorBoundary>
      </div>
    </section>

    {/* The floating widget overlays the panes (click-through stage, interactive
        shell). Morphable so the dock button demonstrates the widget↔sidebar morph. */}
    <AppErrorBoundary label="root-pane-widget">
      <ChatApp
        mode="floating"
        storageKey="tinytinkerer:root-widget-layout"
        LoadingComponent={RootChatLoading}
        stageClassName="root-widget-overlay"
      />
    </AppErrorBoundary>
  </div>
)
