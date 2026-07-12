import { AppFrame } from './app-frame'
import { AppStageShell } from './app-stage-shell'
import type { ChatAppProps } from '@tinytinkerer/app-browser'
import type { AppFrameStatus } from './app-frame'
import type { AppBridgeHandle } from './bridge-handle'

export type HarnessShellProps = {
  appId: string
  src: string
  appProtocolVersion: number
  expectedVerbs: readonly string[]
  handle: AppBridgeHandle
  frameTitle: string
  chat: Omit<ChatAppProps, 'stageClassName' | 'mode' | 'morphable' | 'onModeChange'>
  className?: string
  persistenceKey?: string
  onStatusChange?: (status: AppFrameStatus) => void
}

// The iframe-specific composition remains deliberately thin; AppStageShell owns the
// shared dock/float layout and is also reusable by trusted in-process applications.
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
  <AppStageShell chat={chat} {...(className ? { className } : {})}>
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
  </AppStageShell>
)
