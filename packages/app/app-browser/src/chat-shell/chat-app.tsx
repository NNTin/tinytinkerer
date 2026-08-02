import { useState, type ReactNode } from 'react'
import {
  createChatPresentationStore,
  setChatPresentationMinimized,
  setChatPresentationMode,
  useChatPresentation,
  type ChatMode,
  type ChatPresentation
} from '../chat-presentation'
import { DockedChatSurface } from './docked-chat-surface'
import { FloatingChatSurface, type ChatLoadingComponent } from './floating-chat-surface'
import { FloatingLayout } from './floating-layout'
import { SidebarLayout } from './sidebar-layout'
import type { DockedSizeVariant } from './docked-chat-surface'
import type { SnapEdge } from './layout-geometry'

export type { ChatMode }

type ChatAppBaseProps = {
  // Whether the dock/undock toggle is offered (default true). Set false to pin the
  // layout (e.g. the canvas overlay, or a fixed pane in the root composition).
  morphable?: boolean
  // Base localStorage key. Geometry persists under `:floating` / `:sidebar`; an
  // UNCONTROLLED ChatApp persists its complete presentation under `:presentation`.
  // A controlled ChatApp never reads or writes that presentation key.
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
  focusPanelOnMount?: boolean
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  stageClassName?: string
  // Cold-start suggestions for this surface, replacing the app's own
  // `starterPrompts` in the derived list (issue #480).
  starterPrompts?: readonly string[]
  // How many suggestions the empty state offers. Defaults to each body's own
  // historical count.
  starterPromptCount?: number
}

type UncontrolledChatPresentationProps = {
  /**
   * Initial layout for an uncontrolled ChatApp. A persisted presentation wins
   * when morphing is enabled. A controlled host supplies `presentation` instead.
   */
  mode?: ChatMode
  presentation?: never
  onPresentationChange?: never
  /**
   * Optional initial override for an uncontrolled surface. The shell uses this
   * for `?window=minimized`.
   */
  initialMinimized?: boolean
}

type ControlledChatPresentationProps = {
  mode?: never
  /**
   * The complete controlled presentation. `mode`, `minimized`, and `edge` move
   * together so an embedder cannot accidentally create a second authority for
   * one axis. Both controlled props must be supplied together.
   */
  presentation: ChatPresentation
  onPresentationChange: (presentation: ChatPresentation) => void
  initialMinimized?: never
}

export type ChatAppProps = ChatAppBaseProps &
  (UncontrolledChatPresentationProps | ControlledChatPresentationProps)

type ChatAppLayoutProps = ChatAppBaseProps & ControlledChatPresentationProps

/**
 * Layout-only half of ChatApp. It has no presentation storage or local mode/edge
 * state: every reader action becomes one complete value for its owner.
 */
const ChatAppLayout = ({
  presentation,
  onPresentationChange,
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
  focusPanelOnMount,
  defaultWidth,
  defaultHeight,
  minWidth,
  minHeight,
  stageClassName,
  starterPrompts,
  starterPromptCount
}: ChatAppLayoutProps): ReactNode => {
  const morphTo = (mode: ChatMode, edge?: SnapEdge): void => {
    onPresentationChange(
      setChatPresentationMode(
        presentation,
        mode,
        edge ?? (mode === 'sidebar' ? side : presentation.edge)
      )
    )
  }

  if (presentation.mode === 'sidebar') {
    return (
      <SidebarLayout
        storageKey={`${storageKey}:sidebar`}
        {...(stageClassName !== undefined ? { stageClassName } : {})}
        sizeVariant={sizeVariant}
        side={side}
        edge={presentation.edge}
        // The morph target is the resizable web-mode split (#324); the pinned panes
        // (root composition, /web, /mobile) keep their static `resizable` prop.
        resizable={morphable ? true : resizable}
        fill={fill}
        {...(morphable ? { onUndock: () => morphTo('floating') } : {})}
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
      minimized={presentation.minimized}
      onMinimizedChange={(minimized) =>
        onPresentationChange(setChatPresentationMinimized(presentation, minimized))
      }
      {...(focusPanelOnMount !== undefined ? { focusPanelOnMount } : {})}
      {...(morphable ? { onDock: (edge?: SnapEdge) => morphTo('sidebar', edge) } : {})}
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

type UncontrolledChatAppProps = ChatAppBaseProps & UncontrolledChatPresentationProps

/** One complete product-owned presentation record for an ordinary mounted shell. */
const UncontrolledChatApp = ({
  mode = 'floating',
  morphable = true,
  side = 'right',
  initialMinimized,
  storageKey,
  ...props
}: UncontrolledChatAppProps): ReactNode => {
  const [store] = useState(() =>
    createChatPresentationStore({
      storageKey,
      // Fixed panes have no morph control, so they neither inherit nor create a
      // presentation preference that another surface could later mistake for one.
      persist: morphable,
      defaultPresentation: {
        mode,
        minimized: initialMinimized ?? false,
        edge: side
      },
      // An explicit URL/window override wins for this mount. Omitting it lets a
      // normal morphable product surface restore all three persisted axes.
      hydrate: (persisted) =>
        initialMinimized === undefined ? persisted : { ...persisted, minimized: initialMinimized }
    })
  )
  const presentation = useChatPresentation(store)

  return (
    <ChatAppLayout
      {...props}
      morphable={morphable}
      side={side}
      storageKey={storageKey}
      presentation={presentation}
      onPresentationChange={(next) => store.update(() => next)}
    />
  )
}

// The single shared chat App: one session (the surface hooks + stores live above
// this in AppBrowserProvider) rendered through a pluggable layout shell. Because
// only the layout wrapper swaps on morph, the conversation and an in-flight run
// survive the dock/undock toggle.
export const ChatApp = ({
  presentation,
  onPresentationChange,
  mode,
  initialMinimized,
  ...props
}: ChatAppProps): ReactNode => {
  const controlled = presentation !== undefined || onPresentationChange !== undefined
  if (controlled) {
    if (presentation === undefined || onPresentationChange === undefined) {
      throw new Error(
        'ChatApp requires presentation and onPresentationChange together when controlled.'
      )
    }
    return (
      <ChatAppLayout
        {...props}
        presentation={presentation}
        onPresentationChange={onPresentationChange}
      />
    )
  }

  return (
    <UncontrolledChatApp
      {...props}
      {...(mode !== undefined ? { mode } : {})}
      {...(initialMinimized !== undefined ? { initialMinimized } : {})}
    />
  )
}
