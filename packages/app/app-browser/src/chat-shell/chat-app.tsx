import { useState, type ReactNode } from 'react'
import { DockedChatSurface } from './docked-chat-surface'
import { FloatingChatSurface, type ChatLoadingComponent } from './floating-chat-surface'
import { FloatingLayout } from './floating-layout'
import { SidebarLayout } from './sidebar-layout'
import type { DockedSizeVariant } from './docked-chat-surface'
import type { SnapEdge } from './layout-geometry'

export type ChatMode = 'floating' | 'sidebar'

export type ChatAppProps = {
  // Which layout to show first. Uncontrolled: ChatApp owns the live mode so the
  // dock/undock toggle can morph between layouts without remounting the session.
  mode?: ChatMode
  onModeChange?: (mode: ChatMode) => void
  // Whether the dock/undock toggle is offered (default true). Set false to pin the
  // layout (e.g. the canvas overlay, or a fixed pane in the root composition).
  morphable?: boolean
  // Base localStorage key; each layout persists its own geometry under a suffix
  // (`:floating`, `:sidebar`) and the chosen mode under `:mode`.
  storageKey: string
  LoadingComponent: ChatLoadingComponent
  // Docked (sidebar) body presentation.
  sizeVariant?: DockedSizeVariant
  side?: 'left' | 'right'
  resizable?: boolean
  fill?: boolean
  installSlot?: ReactNode
  inspectorPanelSupported?: boolean
  settingsFallback?: ReactNode
  // Floating body/window passthrough.
  framed?: boolean
  initialMinimized?: boolean
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  stageClassName?: string
}

const readStoredMode = (storageKey: string): ChatMode | null => {
  try {
    const stored = window.localStorage.getItem(`${storageKey}:mode`)
    return stored === 'floating' || stored === 'sidebar' ? stored : null
  } catch {
    return null
  }
}

const readStoredEdge = (storageKey: string): SnapEdge | null => {
  try {
    const stored = window.localStorage.getItem(`${storageKey}:edge`)
    return stored === 'top' || stored === 'bottom' || stored === 'left' || stored === 'right'
      ? stored
      : null
  } catch {
    return null
  }
}

// The single shared chat App: one session (the surface hooks + stores live above
// this in AppBrowserProvider) rendered through a pluggable layout shell. Because
// only the layout wrapper swaps on morph, the conversation and any in-flight run
// survive the dock/undock toggle.
export const ChatApp = ({
  mode = 'floating',
  onModeChange,
  morphable = true,
  storageKey,
  LoadingComponent,
  sizeVariant = 'comfortable',
  side = 'right',
  resizable = false,
  fill = false,
  installSlot,
  inspectorPanelSupported,
  settingsFallback,
  framed = false,
  initialMinimized = false,
  defaultWidth,
  defaultHeight,
  minWidth,
  minHeight,
  stageClassName
}: ChatAppProps) => {
  const [activeMode, setActiveMode] = useState<ChatMode>(
    () => (morphable ? readStoredMode(storageKey) : null) ?? mode
  )
  // Which edge the docked "web mode" fills. Set by the dock button (the configured
  // `side`) or by a snap-drag release near a viewport edge (#324), and persisted so a
  // reload restores the same split.
  const [dockEdge, setDockEdge] = useState<SnapEdge>(
    () => (morphable ? readStoredEdge(storageKey) : null) ?? side
  )

  // Morph into the docked web mode. `edge` comes from a snap-drag release; the plain
  // dock button omits it and docks to the configured `side`.
  const dockTo = (edge?: SnapEdge) => {
    const target: SnapEdge = edge ?? side
    setDockEdge(target)
    setActiveMode('sidebar')
    try {
      window.localStorage.setItem(`${storageKey}:mode`, 'sidebar')
      window.localStorage.setItem(`${storageKey}:edge`, target)
    } catch {
      // Non-fatal: the mode/edge just won't persist across reloads.
    }
    onModeChange?.('sidebar')
  }

  const undock = () => {
    setActiveMode('floating')
    try {
      window.localStorage.setItem(`${storageKey}:mode`, 'floating')
    } catch {
      // Non-fatal.
    }
    onModeChange?.('floating')
  }

  if (activeMode === 'sidebar') {
    return (
      <SidebarLayout
        storageKey={`${storageKey}:sidebar`}
        sizeVariant={sizeVariant}
        side={side}
        edge={dockEdge}
        // The morph target is the resizable web-mode split (#324); the pinned panes
        // (root composition, /web, /mobile) keep their static `resizable` prop.
        resizable={morphable ? true : resizable}
        fill={fill}
        {...(morphable ? { onUndock: undock } : {})}
      >
        <DockedChatSurface
          LoadingComponent={LoadingComponent}
          sizeVariant={sizeVariant}
          installSlot={installSlot}
          settingsFallback={settingsFallback}
          {...(inspectorPanelSupported !== undefined ? { inspectorPanelSupported } : {})}
        />
      </SidebarLayout>
    )
  }

  return (
    <FloatingLayout
      storageKey={`${storageKey}:floating`}
      initialMinimized={initialMinimized}
      {...(morphable ? { onDock: dockTo } : {})}
      {...(defaultWidth !== undefined ? { defaultWidth } : {})}
      {...(defaultHeight !== undefined ? { defaultHeight } : {})}
      {...(minWidth !== undefined ? { minWidth } : {})}
      {...(minHeight !== undefined ? { minHeight } : {})}
      {...(stageClassName !== undefined ? { stageClassName } : {})}
    >
      <FloatingChatSurface
        LoadingComponent={LoadingComponent}
        framed={framed}
        {...(inspectorPanelSupported !== undefined ? { inspectorPanelSupported } : {})}
      />
    </FloatingLayout>
  )
}
