import { ChatApp } from '@tinytinkerer/app-browser'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ChatAppProps, ChatMode } from '@tinytinkerer/app-browser'

export type AppStageShellProps = {
  children: ReactNode
  chat: Omit<ChatAppProps, 'stageClassName' | 'mode' | 'onModeChange'>
  initialChatMode?: ChatMode
  className?: string
}

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

// Generic composition for a trusted in-process application stage and assistant.
export const AppStageShell = ({
  children,
  chat,
  initialChatMode = 'floating',
  className
}: AppStageShellProps): React.JSX.Element => {
  const chatRef = useRef<HTMLDivElement>(null)
  const [stageInset, setStageInset] = useState<CSSProperties>({})

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
      setStageInset(next)
    }
    measure()
    const observer = new MutationObserver(measure)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'data-edge']
    })
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

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
