import { ChatApp } from '@tinytinkerer/app-browser'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AppFrame } from './app-frame'
import type { ChatAppProps } from '@tinytinkerer/app-browser'
import type { AppFrameStatus } from './app-frame'
import type { AppBridgeHandle } from './bridge-handle'

export type HarnessShellProps = {
  appId: string
  src: string
  appProtocolVersion: number
  expectedVerbs: readonly string[]
  // The shared bridge handle (see createAppBridgeHandle). MUST be stable.
  handle: AppBridgeHandle
  frameTitle: string
  // Shared ChatApp configuration (storageKey, LoadingComponent, …). The harness owns
  // the layout wiring (mode, morphability, the click-through overlay), so those props
  // are supplied here, not by the per-app shell.
  chat: Omit<ChatAppProps, 'stageClassName' | 'mode' | 'morphable' | 'onModeChange'>
  className?: string
  // localStorage key for persisting the embedded app's opaque scene snapshot across
  // reloads. Omit to disable persistence. See AppFrame.persistenceKey.
  persistenceKey?: string
  onStatusChange?: (status: AppFrameStatus) => void
}

// Read the docked chat panel's footprint from the DOM so the iframe can shrink to the
// complementary region. The panel's edge + size are owned by app-browser's
// SidebarLayout (it renders `.sidebar-panel[data-edge]` with an inline width/height),
// so the harness observes that element rather than duplicating the layout state.
const insetForPanel = (panel: HTMLElement): CSSProperties => {
  const rect = panel.getBoundingClientRect()
  switch (panel.dataset.edge) {
    case 'right':
      return { right: Math.round(rect.width) }
    case 'left':
      return { left: Math.round(rect.width) }
    case 'top':
      return { top: Math.round(rect.height) }
    case 'bottom':
      return { bottom: Math.round(rect.height) }
    default:
      return {}
  }
}

const insetSignature = (inset: CSSProperties): string =>
  `${inset.top ?? ''}|${inset.right ?? ''}|${inset.bottom ?? ''}|${inset.left ?? ''}`

// The thin per-app shell body: the embedded iframe app fills the stage as the base
// layer and the shared chat floats above it (click-through, so the app stays usable).
// The chat is morphable — dragging it to a viewport edge docks it into the resizable
// "web mode" split (#324), and the harness shrinks the iframe into the space the
// docked panel leaves so the app and chat sit side by side. A per-app shell (e.g.
// apps/canvas) renders this, points it at its app page, and declares its verbs — no
// app domain logic or third-party deps.
export const HarnessShell = ({
  appId,
  src,
  appProtocolVersion,
  expectedVerbs,
  handle,
  frameTitle,
  chat,
  className,
  persistenceKey,
  onStatusChange
}: HarnessShellProps): React.JSX.Element => {
  const chatRef = useRef<HTMLDivElement>(null)
  const [frameInset, setFrameInset] = useState<CSSProperties>({})

  // Track the docked panel's footprint (present only in web mode) and shrink the
  // iframe region to match — on dock/undock, on live divider resize, and on window
  // resize. Observing the DOM (rather than a mode callback) also covers the panel
  // being restored from persistence on mount, and keeps the layout state single-owned
  // in app-browser. The signature guard avoids redundant re-renders while dragging.
  useEffect(() => {
    const root = chatRef.current
    if (!root) return

    let lastSignature = insetSignature({})

    const measure = () => {
      const panel = root.querySelector<HTMLElement>('.sidebar-panel')
      const next = panel ? insetForPanel(panel) : {}
      const signature = insetSignature(next)
      if (signature === lastSignature) return
      lastSignature = signature
      setFrameInset(next)
    }

    measure()
    const mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'data-edge']
    })
    window.addEventListener('resize', measure)

    return () => {
      mutationObserver.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return (
    <div className={['app-harness-stage', className].filter(Boolean).join(' ')}>
      <div className="app-harness-frame-region" style={frameInset}>
        <AppFrame
          className="app-harness-frame"
          appId={appId}
          src={src}
          appProtocolVersion={appProtocolVersion}
          expectedVerbs={expectedVerbs}
          handle={handle}
          title={frameTitle}
          {...(persistenceKey !== undefined ? { persistenceKey } : {})}
          {...(onStatusChange ? { onStatusChange } : {})}
        />
      </div>
      <div className="app-harness-chat" ref={chatRef}>
        <ChatApp {...chat} mode="floating" />
      </div>
    </div>
  )
}
