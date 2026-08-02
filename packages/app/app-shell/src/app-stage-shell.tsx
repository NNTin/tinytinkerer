import { ChatApp, useDockedPanelMetrics } from '@tinytinkerer/app-browser'
import type { CSSProperties, ReactNode } from 'react'
import type { ChatAppProps, ChatMode } from '@tinytinkerer/app-browser'

export type AppStageShellProps = {
  children: ReactNode
  chat: Omit<ChatAppProps, 'stageClassName' | 'mode' | 'onModeChange'>
  initialChatMode?: ChatMode
  className?: string
}

// Generic composition for a trusted in-process application stage and assistant.
export const AppStageShell = ({
  children,
  chat,
  initialChatMode = 'floating',
  className
}: AppStageShellProps): React.JSX.Element => {
  // The measurement itself lives in app-browser, beside the layout that produces
  // it, so a second host can inset its own stage from the same numbers rather
  // than growing a private copy of this effect (issue #480 re-review, finding 2).
  const { ref: chatRef, metrics } = useDockedPanelMetrics()
  const stageInset: CSSProperties = metrics ? { [metrics.edge]: metrics.size } : {}

  return (
    <div className={['app-stage-shell', className].filter(Boolean).join(' ')}>
      <div className="app-stage-region" style={stageInset}>
        {children}
      </div>
      <div className="app-stage-chat" ref={chatRef}>
        <ChatApp {...chat} mode={initialChatMode} />
      </div>
    </div>
  )
}
