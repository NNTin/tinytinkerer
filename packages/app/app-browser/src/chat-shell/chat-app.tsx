import { useState, type ReactNode } from 'react'
import {
  DEFAULT_CHAT_PRESENTATION,
  readChatPresentation,
  setChatPresentationMode,
  writeChatPresentation,
  type ChatMode
} from '../chat-presentation'
import { DockedChatSurface } from './docked-chat-surface'
import { FloatingChatSurface, type ChatLoadingComponent } from './floating-chat-surface'
import { FloatingLayout } from './floating-layout'
import { SidebarLayout } from './sidebar-layout'
import type { DockedSizeVariant } from './docked-chat-surface'
import type { SnapEdge } from './layout-geometry'

export type { ChatMode }

export type ChatAppProps = {
  // Which layout to show.
  //
  // Uncontrolled by default: ChatApp owns the live mode (seeded from `mode`, then
  // from its own persistence) so the dock/undock toggle can morph between layouts
  // without remounting the session.
  //
  // CONTROLLED when `onModeChange` is also given (issue #480 re-review, finding
  // 2). A host that persists its own presentation — the documentation assistant
  // keeps `mode` beside open/minimized in one versioned record — must be the
  // single authority, or two stores end up disagreeing about whether the reader
  // left the assistant docked.
  mode?: ChatMode
  onModeChange?: (mode: ChatMode) => void
  // Whether the dock/undock toggle is offered (default true). Set false to pin the
  // layout (e.g. the canvas overlay, or a fixed pane in the root composition).
  morphable?: boolean
  // Base localStorage key; each layout persists its own geometry under a suffix
  // (`:floating`, `:sidebar`) and the presentation record — mode and dock edge —
  // under `:presentation`, in the shared format from ../chat-presentation.
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
  // Controlled minimization (issue #480). See FloatingLayout for why a caller
  // that owns open/minimized must own it outright rather than mirror it.
  minimized?: boolean
  onMinimizedChange?: (minimized: boolean) => void
  focusPanelOnMount?: boolean
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  stageClassName?: string
  // Cold-start suggestions for this surface, replacing the app's own
  // `starterPrompts` in the derived list (issue #480). A prop rather than app
  // state because the useful ones change with what the host is showing — the
  // documentation assistant recomputes them per route — and `BrowserApp` is
  // built once per session.
  starterPrompts?: readonly string[]
  // How many suggestions the empty state offers. Defaults to each body's own
  // historical count.
  starterPromptCount?: number
}

// The persisted presentation, or nothing. Reading it through the shared parser
// rather than pulling two ad-hoc string keys is what keeps this and an embedder
// that owns presentation (the documentation assistant) on ONE storage format.
const readStoredPresentation = (storageKey: string, morphable: boolean) =>
  morphable ? readChatPresentation(storageKey) : null

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
  minimized,
  onMinimizedChange,
  focusPanelOnMount,
  defaultWidth,
  defaultHeight,
  minWidth,
  minHeight,
  stageClassName,
  starterPrompts,
  starterPromptCount
}: ChatAppProps) => {
  // Controlled exactly when the caller supplies both halves. Adopting the
  // controlled value during RENDER (rather than in an effect) is what keeps a
  // host-driven change — restoring a persisted `sidebar` on activation, say —
  // from being visible for one frame as the other layout.
  const controlled = onModeChange !== undefined && mode !== undefined
  const [stored] = useState(() => readStoredPresentation(storageKey, morphable))
  const [uncontrolledMode, setUncontrolledMode] = useState<ChatMode>(
    () => stored?.mode ?? mode ?? 'floating'
  )
  const activeMode = controlled ? mode : uncontrolledMode
  // Which edge the docked "web mode" fills. Set by the dock button (the configured
  // `side`) or by a snap-drag release near a viewport edge (#324), and persisted so a
  // reload restores the same split.
  const [dockEdge, setDockEdge] = useState<SnapEdge>(() => stored?.edge ?? side)

  /**
   * The one place a morph happens, for both directions.
   *
   * The TRANSITION is the shared one, so "docking clears minimized" is decided
   * in a single place whoever drives the morph; what varies is only who keeps the
   * result. A controlled host owns which LAYOUT is shown and persists its own
   * record, so this writes nothing for it — except the edge, which is ChatApp's
   * either way: a host owns floating-versus-docked, not which viewport edge a
   * snap-drag released against.
   */
  const morphTo = (next: ChatMode, edge?: SnapEdge): void => {
    const target: SnapEdge = edge ?? (next === 'sidebar' ? side : dockEdge)
    setDockEdge(target)
    if (!controlled) setUncontrolledMode(next)
    const current = readChatPresentation(storageKey) ?? {
      ...DEFAULT_CHAT_PRESENTATION,
      mode: activeMode,
      edge: dockEdge
    }
    const persisted = setChatPresentationMode(current, next, target)
    writeChatPresentation(
      storageKey,
      // A controlled host is the authority on mode; only the edge is ours to keep.
      controlled ? { ...current, edge: target } : persisted
    )
    onModeChange?.(next)
  }

  // `edge` comes from a snap-drag release; the plain dock button omits it and
  // docks to the configured `side`.
  const dockTo = (edge?: SnapEdge) => {
    morphTo('sidebar', edge)
  }

  const undock = () => {
    morphTo('floating')
  }

  if (activeMode === 'sidebar') {
    return (
      <SidebarLayout
        storageKey={`${storageKey}:sidebar`}
        {...(stageClassName !== undefined ? { stageClassName } : {})}
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
          {...(starterPrompts !== undefined ? { starterPrompts } : {})}
          {...(starterPromptCount !== undefined ? { starterPromptCount } : {})}
        />
      </SidebarLayout>
    )
  }

  return (
    <FloatingLayout
      storageKey={`${storageKey}:floating`}
      initialMinimized={initialMinimized}
      {...(minimized !== undefined ? { minimized } : {})}
      {...(onMinimizedChange !== undefined ? { onMinimizedChange } : {})}
      {...(focusPanelOnMount !== undefined ? { focusPanelOnMount } : {})}
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
        {...(starterPrompts !== undefined ? { starterPrompts } : {})}
        {...(starterPromptCount !== undefined ? { starterPromptCount } : {})}
      />
    </FloatingLayout>
  )
}
