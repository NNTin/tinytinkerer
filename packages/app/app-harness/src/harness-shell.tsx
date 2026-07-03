import { ChatApp } from '@tinytinkerer/app-browser'
import type { ChatAppProps } from '@tinytinkerer/app-browser'
import { AppFrame } from './app-frame'
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
  // Shared ChatApp configuration (storageKey, LoadingComponent, …). The harness
  // pins it to the floating layout (non-morphable) and supplies `stageClassName`
  // for the click-through overlay.
  chat: Omit<ChatAppProps, 'stageClassName' | 'mode' | 'morphable' | 'onModeChange'>
  className?: string
  // localStorage key for persisting the embedded app's opaque scene snapshot across
  // reloads. Omit to disable persistence. See AppFrame.persistenceKey.
  persistenceKey?: string
  onStatusChange?: (status: AppFrameStatus) => void
}

// The thin per-app shell body: the embedded iframe app fills the stage as the base
// layer and the shared chat floats above it (click-through, so the app stays
// usable). A per-app shell (e.g. apps/canvas) renders this, points it at its app
// page, and declares its verbs — no app domain logic or third-party deps.
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
}: HarnessShellProps): React.JSX.Element => (
  <div className={['app-harness-stage', className].filter(Boolean).join(' ')}>
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
    <ChatApp
      {...chat}
      mode="floating"
      morphable={false}
      stageClassName="app-harness-chat-overlay"
    />
  </div>
)
