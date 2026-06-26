import {
  ConversationEmptyState,
  JumpToLatestButton,
  LazySettingsPanel,
  TINYTINKERER_BRAND_ASSET_URLS,
  TurnChrome,
  shellThemeToCssVars,
  useBrowserShellConfig,
  useChatComposer,
  useChatSurfaceController,
  useSettingsSurfaceController,
  useStickToBottom
} from '@tinytinkerer/app-browser'
import {
  Button,
  FaArrowUp,
  FaGear,
  FaGithub,
  FaMicrophone,
  FaRotateLeft,
  FaStop
} from '@tinytinkerer/ui'
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { WidgetChatLoading } from '../../app/loading-screen'
import { resolveWidgetViewMode, resolveWidgetWindowMode } from '../../runtime-config'

const STANDALONE_LAYOUT_KEY = 'tinytinkerer:widget-layout:v1'
const WIDGET_DEFAULT_WIDTH = 400
const WIDGET_DEFAULT_HEIGHT = 680
const WIDGET_MIN_WIDTH = 320
const WIDGET_MIN_HEIGHT = 420
const WIDGET_MINIMIZED_SIZE = 64
const WIDGET_SAFE_MARGIN = 24
// Keyboard nudge step for moving/resizing the standalone window (C1).
const WIDGET_KEYBOARD_STEP = 16

type WidgetLayout = {
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const clampLayout = (layout: WidgetLayout): WidgetLayout => {
  const width = clamp(
    Math.round(layout.width),
    WIDGET_MIN_WIDTH,
    Math.max(WIDGET_MIN_WIDTH, window.innerWidth - WIDGET_SAFE_MARGIN * 2)
  )
  const height = clamp(
    Math.round(layout.height),
    WIDGET_MIN_HEIGHT,
    Math.max(WIDGET_MIN_HEIGHT, window.innerHeight - WIDGET_SAFE_MARGIN * 2)
  )
  const boxWidth = layout.minimized ? WIDGET_MINIMIZED_SIZE : width
  const boxHeight = layout.minimized ? WIDGET_MINIMIZED_SIZE : height

  return {
    ...layout,
    width,
    height,
    x: clamp(
      Math.round(layout.x),
      WIDGET_SAFE_MARGIN,
      Math.max(WIDGET_SAFE_MARGIN, window.innerWidth - boxWidth - WIDGET_SAFE_MARGIN)
    ),
    y: clamp(
      Math.round(layout.y),
      WIDGET_SAFE_MARGIN,
      Math.max(WIDGET_SAFE_MARGIN, window.innerHeight - boxHeight - WIDGET_SAFE_MARGIN)
    )
  }
}

const createDefaultStandaloneLayout = (): WidgetLayout =>
  clampLayout({
    x: Math.round((window.innerWidth - WIDGET_DEFAULT_WIDTH) / 2),
    y: Math.round(window.innerHeight - WIDGET_DEFAULT_HEIGHT - 32),
    width: WIDGET_DEFAULT_WIDTH,
    height: WIDGET_DEFAULT_HEIGHT,
    minimized: false
  })

const loadStandaloneLayout = (): WidgetLayout => {
  const stored = window.localStorage.getItem(STANDALONE_LAYOUT_KEY)
  if (!stored) {
    return createDefaultStandaloneLayout()
  }

  try {
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null) {
      return createDefaultStandaloneLayout()
    }
    const r = parsed as Record<string, unknown>
    if (
      typeof r.x !== 'number' ||
      typeof r.y !== 'number' ||
      typeof r.width !== 'number' ||
      typeof r.height !== 'number'
    ) {
      return createDefaultStandaloneLayout()
    }

    return clampLayout({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      minimized: r.minimized === true
    })
  } catch {
    return createDefaultStandaloneLayout()
  }
}

const saveStandaloneLayout = (layout: WidgetLayout): void => {
  window.localStorage.setItem(STANDALONE_LAYOUT_KEY, JSON.stringify(layout))
}

const WidgetLauncher = ({ onRestore }: { onRestore: () => void }) => (
  <div className="flex h-full items-center justify-center p-2">
    <button
      type="button"
      onClick={onRestore}
      aria-label="Restore widget"
      className="widget-launcher inline-flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-[var(--widget-border)] bg-[var(--widget-panel)] shadow-[0_18px_48px_rgba(36,33,24,0.16)]"
    >
      <img src={TINYTINKERER_BRAND_ASSET_URLS.icon192} alt="" className="h-11 w-11 rounded-2xl" />
      <span className="sr-only">Restore widget</span>
    </button>
  </div>
)

const WidgetShellBar = ({
  onMinimize,
  onMovePointerDown,
  onMoveKeyDown
}: {
  onMinimize: () => void
  onMovePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onMoveKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
}) => (
  <div className="widget-shell-bar border-b border-[var(--widget-border)]">
    <button
      type="button"
      className="widget-shell-grip"
      aria-label="Move widget. Use arrow keys to move, Shift with arrow keys to resize."
      title="Move widget (arrow keys move, Shift+arrows resize)"
      onPointerDown={onMovePointerDown}
      {...(onMoveKeyDown ? { onKeyDown: onMoveKeyDown } : {})}
    />
    <button
      type="button"
      className="widget-shell-minimize"
      aria-label="Minimize widget"
      title="Minimize widget"
      onClick={onMinimize}
    >
      <span aria-hidden="true" />
    </button>
  </div>
)

const WidgetWindow = ({
  minimized,
  dragging,
  onRestore,
  onMinimize,
  onMovePointerDown,
  onMoveKeyDown,
  children,
  resizeHandle,
  className,
  style
}: {
  minimized: boolean
  dragging: boolean
  onRestore: () => void
  onMinimize: () => void
  onMovePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onMoveKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
  children: ReactNode
  resizeHandle?: ReactNode
  className?: string
  style?: CSSProperties
}) => (
  <div
    className={['widget-floating-shell', className].filter(Boolean).join(' ')}
    data-dragging={dragging ? 'true' : 'false'}
    data-minimized={minimized ? 'true' : 'false'}
    style={style}
  >
    <div className="widget-shell-body">
      {minimized ? (
        <WidgetLauncher onRestore={onRestore} />
      ) : (
        <>
          <WidgetShellBar
            onMinimize={onMinimize}
            onMovePointerDown={onMovePointerDown}
            {...(onMoveKeyDown ? { onMoveKeyDown } : {})}
          />
          {children}
        </>
      )}
    </div>
    {!minimized ? resizeHandle : null}
  </div>
)

const WidgetSurface = ({ framed = true }: { framed?: boolean }) => {
  const {
    isBooting,
    initializeError,
    events,
    turns,
    serverNameById,
    isRunning,
    isRetryPending,
    submitLabel,
    isCoolingDown,
    submitPrompt,
    rerunLastPrompt,
    canRerun,
    resetConversation,
    cancelRetry,
    stop
  } = useChatSurfaceController()
  const { token } = useSettingsSurfaceController()
  const { prompt, setPrompt, speech, handleSubmit } = useChatComposer(submitPrompt)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { scrollRef, showJumpButton, scrollToBottom } = useStickToBottom<HTMLDivElement>(events)

  if (isBooting || initializeError) {
    return <WidgetChatLoading {...(initializeError ? { error: initializeError } : {})} />
  }

  return (
    <div className="relative flex h-full w-full flex-col px-2.5 py-2.5">
      <div
        className={[
          'flex h-full min-h-0 flex-col',
          framed
            ? 'rounded-[1.5rem] border border-[var(--widget-border)] bg-[var(--widget-panel)] shadow-[0_18px_48px_rgba(36,33,24,0.08)]'
            : 'bg-transparent'
        ].join(' ')}
      >
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          {turns.length === 0 ? (
            <ConversationEmptyState count={1} onSelectPrompt={setPrompt} />
          ) : (
            <div className="space-y-2.5">
              {turns.map((turn, index) => (
                <div key={turn.id} className="space-y-1">
                  {turn.userText ? (
                    <div className="rounded-xl bg-[var(--user-bubble)] px-2.5 py-1.5 text-[13px] leading-5 text-[var(--text)]">
                      {turn.userText}
                    </div>
                  ) : null}
                  {turn.notice ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-4 text-amber-800">
                      {turn.notice.message}
                    </div>
                  ) : null}
                  <TurnChrome
                    turn={turn}
                    isLive={isRunning && index === turns.length - 1}
                    serverNameById={serverNameById}
                    bubbleClassName="rounded-xl border border-[var(--widget-border)] bg-[var(--panel)] px-2.5 py-2"
                    contentClassName="widget-prose text-[13px] leading-5"
                    {...(index === turns.length - 1
                      ? {
                          onRegenerateLatest: () => void rerunLastPrompt(),
                          canRegenerateLatest: canRerun
                        }
                      : {})}
                  />
                </div>
              ))}
            </div>
          )}
          <JumpToLatestButton
            visible={showJumpButton}
            onClick={() => scrollToBottom()}
            className="sticky bottom-1 left-1/2 z-10 -translate-x-1/2"
          />
        </div>

        <div className="border-t border-[var(--widget-border)] px-3 py-2.5">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (!isCoolingDown) handleSubmit()
              }
            }}
            aria-label="Message"
            placeholder="Ask something current, compare options, or continue the thread."
            rows={2}
            className="min-h-16 max-h-28 w-full rounded-xl border border-[var(--widget-border)] bg-[var(--panel)] px-3 py-2 text-[13px] leading-5 outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
            {/* Left: settings, sign in, reset */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Settings"
                title="Settings"
                onClick={() => setSettingsOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--widget-border)] bg-[var(--panel)] text-[var(--widget-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--panel-hover)] hover:text-[var(--widget-text)]"
              >
                <FaGear className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              {!token ? (
                <button
                  type="button"
                  aria-label="Sign in with GitHub"
                  title="Sign in with GitHub"
                  onClick={() => setSettingsOpen(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--widget-border)] bg-[var(--panel)] text-[var(--widget-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--panel-hover)] hover:text-[var(--widget-text)]"
                >
                  <FaGithub className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Reset conversation"
                title="Reset conversation"
                onClick={() => void resetConversation()}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--widget-border)] bg-[var(--panel)] text-[var(--widget-muted)] transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
              >
                <FaRotateLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            {/* Right: microphone, stop/send */}
            <div className="flex items-center gap-1.5">
              {speech.visible ? (
                <button
                  type="button"
                  aria-label={speech.available ? 'Voice input' : 'Voice input unavailable'}
                  aria-pressed={speech.listening}
                  title={
                    !speech.available
                      ? 'Voice input is not available in this browser'
                      : speech.listening
                        ? 'Stop voice input'
                        : 'Dictate with the Web Speech API'
                  }
                  disabled={!speech.available}
                  onClick={() => void speech.toggle()}
                  className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    speech.listening
                      ? 'border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100'
                      : 'border-[var(--widget-border)] bg-[var(--panel)] text-[var(--widget-muted)] hover:border-[var(--border)] hover:bg-[var(--panel-hover)] hover:text-[var(--widget-text)]'
                  }`}
                >
                  <FaMicrophone className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
              {isRetryPending && isCoolingDown ? (
                <Button size="sm" variant="secondary" onClick={cancelRetry}>
                  Cancel retry
                </Button>
              ) : null}
              {isRunning ? (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="Stop generating"
                  title="Stop generating"
                  onClick={stop}
                  className="h-8 min-w-8 px-2"
                >
                  <FaStop className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  aria-label={isCoolingDown ? `Wait ${submitLabel}` : 'Send'}
                  title={isCoolingDown ? `Wait ${submitLabel}` : 'Send'}
                  onClick={() => handleSubmit()}
                  disabled={isCoolingDown || !prompt.trim()}
                  className="h-8 min-w-8 px-2"
                >
                  {isCoolingDown ? (
                    <span className="text-[11px] tabular-nums">{submitLabel}</span>
                  ) : (
                    <FaArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </Button>
              )}
            </div>
          </div>
          {speech.error ? (
            <p role="alert" className="mt-1.5 text-[11px] text-rose-600">
              {speech.error}
            </p>
          ) : null}
        </div>
      </div>
      {settingsOpen ? (
        <Suspense fallback={null}>
          {/* Inline slide-over rather than a centered modal: the widget is an
              embedded surface, so settings must not cover the host page. */}
          <LazySettingsPanel
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            presentation="inline"
          />
        </Suspense>
      ) : null}
    </div>
  )
}

export const WidgetPage = () => {
  const viewMode = resolveWidgetViewMode(window.location.search)
  const config = useBrowserShellConfig()
  const [layout, setLayout] = useState<WidgetLayout>(() => loadStandaloneLayout())
  const [hostMinimized, setHostMinimized] = useState(
    () => resolveWidgetWindowMode(window.location.search) === 'minimized'
  )
  const [isDragging, setIsDragging] = useState(false)
  const [liveMessage, setLiveMessage] = useState('')
  const dragRef = useRef<{ startX: number; startY: number; startLayout: WidgetLayout } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; startLayout: WidgetLayout } | null>(
    null
  )

  const isStandalone = viewMode === 'standalone'
  const isMinimized = isStandalone ? layout.minimized : hostMinimized
  const themeStyle = shellThemeToCssVars(config.theme)

  useEffect(() => {
    document.body.dataset.widgetViewMode = viewMode
    return () => {
      delete document.body.dataset.widgetViewMode
    }
  }, [viewMode])

  const handleStandaloneMovePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLayout: layout
    }
    setIsDragging(true)
  }

  // Core keyboard nudge for the standalone window (C1). `resize` true adjusts
  // width/height; false moves x/y. Each change is announced via the live region.
  const nudgeLayout = (key: string, resize: boolean): boolean => {
    const deltas: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 }
    }
    const delta = deltas[key]
    if (!delta) {
      return false
    }
    const step = WIDGET_KEYBOARD_STEP

    setLayout((current) => {
      const next = resize
        ? clampLayout({
            ...current,
            width: current.width + delta.x * step,
            height: current.height + delta.y * step
          })
        : clampLayout({
            ...current,
            x: current.x + delta.x * step,
            y: current.y + delta.y * step
          })
      setLiveMessage(
        resize
          ? `Widget resized to ${next.width} by ${next.height} pixels.`
          : `Widget moved to ${next.x}, ${next.y}.`
      )
      return next
    })
    return true
  }

  // Grip: arrows move, Shift+arrows resize.
  const handleGripKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (nudgeLayout(event.key, event.shiftKey)) {
      event.preventDefault()
    }
  }

  // Resize handle: the mirror — arrows resize, Shift+arrows move.
  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (nudgeLayout(event.key, !event.shiftKey)) {
      event.preventDefault()
    }
  }

  const handleHostMovePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.parent === window) {
      return
    }

    setIsDragging(true)

    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    const postDragEvent = (
      phase: 'start' | 'move' | 'end',
      clientX: number,
      clientY: number,
      screenX: number,
      screenY: number
    ) => {
      window.parent.postMessage(
        {
          type: 'tinytinkerer.widget.drag',
          phase,
          clientX,
          clientY,
          screenX,
          screenY
        },
        window.location.origin
      )
    }

    postDragEvent('start', event.clientX, event.clientY, event.screenX, event.screenY)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      postDragEvent(
        'move',
        moveEvent.clientX,
        moveEvent.clientY,
        moveEvent.screenX,
        moveEvent.screenY
      )
    }

    const handlePointerEnd = (endEvent: PointerEvent) => {
      setIsDragging(false)
      postDragEvent('end', endEvent.clientX, endEvent.clientY, endEvent.screenX, endEvent.screenY)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
  }

  useEffect(() => {
    if (!isStandalone) {
      return
    }

    saveStandaloneLayout(layout)
  }, [isStandalone, layout])

  useEffect(() => {
    if (isStandalone || window.parent === window) {
      return
    }

    window.parent.postMessage(
      {
        type: 'tinytinkerer.widget.state',
        mode: hostMinimized ? 'minimized' : 'expanded'
      },
      window.location.origin
    )
  }, [hostMinimized, isStandalone])

  useEffect(() => {
    if (!isStandalone) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (dragRef.current) {
        const { startX, startY, startLayout } = dragRef.current
        setLayout(
          clampLayout({
            ...startLayout,
            x: startLayout.x + (event.clientX - startX),
            y: startLayout.y + (event.clientY - startY)
          })
        )
      }

      if (resizeRef.current) {
        const { startX, startY, startLayout } = resizeRef.current
        setLayout(
          clampLayout({
            ...startLayout,
            width: startLayout.width + (event.clientX - startX),
            height: startLayout.height + (event.clientY - startY)
          })
        )
      }
    }

    const handlePointerUp = () => {
      dragRef.current = null
      resizeRef.current = null
      setIsDragging(false)
    }

    const handleResize = () => {
      setLayout((currentLayout) => clampLayout(currentLayout))
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      window.removeEventListener('resize', handleResize)
    }
  }, [isStandalone])

  const handleMinimize = () => {
    if (isStandalone) {
      setLayout((currentLayout) => clampLayout({ ...currentLayout, minimized: true }))
      return
    }

    setHostMinimized(true)
  }

  const handleRestore = () => {
    if (isStandalone) {
      setLayout((currentLayout) => clampLayout({ ...currentLayout, minimized: false }))
      return
    }

    setHostMinimized(false)
  }

  // Visually-hidden live region announcing keyboard move/resize (C1).
  const liveRegion = (
    <span role="status" aria-live="polite" className="sr-only">
      {liveMessage}
    </span>
  )

  if (!isStandalone) {
    return (
      <div className="widget-stage widget-stage-host" style={themeStyle}>
        {liveRegion}
        <WidgetWindow
          minimized={isMinimized}
          dragging={isDragging}
          onRestore={handleRestore}
          onMinimize={handleMinimize}
          onMovePointerDown={handleHostMovePointerDown}
          className="widget-embedded-shell"
        >
          <WidgetSurface framed={false} />
        </WidgetWindow>
      </div>
    )
  }

  return (
    <div className="widget-stage" style={themeStyle}>
      {liveRegion}
      <WidgetWindow
        minimized={isMinimized}
        dragging={isDragging}
        onRestore={handleRestore}
        onMinimize={handleMinimize}
        onMovePointerDown={handleStandaloneMovePointerDown}
        onMoveKeyDown={handleGripKeyDown}
        style={{
          left: layout.x,
          top: layout.y,
          width: isMinimized ? WIDGET_MINIMIZED_SIZE : layout.width,
          height: isMinimized ? WIDGET_MINIMIZED_SIZE : layout.height
        }}
        resizeHandle={
          <button
            type="button"
            className="widget-shell-resize"
            aria-label="Resize widget. Use arrow keys to resize, Shift with arrow keys to move."
            title="Resize widget (arrow keys resize, Shift+arrows move)"
            onPointerDown={(event) => {
              resizeRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                startLayout: layout
              }
            }}
            onKeyDown={handleResizeKeyDown}
          />
        }
      >
        <WidgetSurface framed={false} />
      </WidgetWindow>
    </div>
  )
}
