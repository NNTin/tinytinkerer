import {
  AssistantContent,
  LazyBrowserSettingsModal,
  TINYTINKERER_BRAND_ASSET_URLS,
  useChatSurfaceController,
  useSettingsSurfaceController
} from '@tinytinkerer/app-browser'
import { Button, GitHubMark } from '@tinytinkerer/ui'
import { Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { WidgetChatLoading } from '../../app/loading-screen'
import { resolveWidgetViewMode, resolveWidgetWindowMode } from '../../runtime-config'

const STANDALONE_LAYOUT_KEY = 'tinytinkerer:widget-layout:v1'
const WIDGET_DEFAULT_WIDTH = 400
const WIDGET_DEFAULT_HEIGHT = 680
const WIDGET_MIN_WIDTH = 320
const WIDGET_MIN_HEIGHT = 420
const WIDGET_MINIMIZED_SIZE = 64
const WIDGET_SAFE_MARGIN = 24
const WIDGET_SHELL_BAR_HEIGHT = 33

type WidgetLayout = {
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

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
  onMovePointerDown
}: {
  onMinimize: () => void
  onMovePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) => (
  <div className="widget-shell-bar border-b border-[var(--widget-border)]">
    <button
      type="button"
      className="widget-shell-grip"
      aria-label="Move widget"
      title="Move widget"
      onPointerDown={onMovePointerDown}
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

const WidgetSurface = ({
  onMinimize,
  onMovePointerDown,
  framed = true
}: {
  onMinimize: () => void
  onMovePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  framed?: boolean
}) => {
  const {
    isBooting,
    initializeError,
    events,
    turns,
    isRunning,
    isRetryPending,
    submitLabel,
    isCoolingDown,
    submitPrompt,
    resetConversation,
    cancelRetry
  } = useChatSurfaceController()
  const {
    token
  } = useSettingsSurfaceController()
  const [prompt, setPrompt] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [events])

  const handleSubmit = async () => {
    const didSend = await submitPrompt(prompt)
    if (didSend) {
      setPrompt('')
    }
  }

  if (isBooting || initializeError) {
    return <WidgetChatLoading {...(initializeError ? { error: initializeError } : {})} />
  }

  return (
    <div className="flex h-full w-full flex-col px-2.5 py-2.5">
      <div
        className={[
          'flex h-full min-h-0 flex-col',
          framed
            ? 'rounded-[1.5rem] border border-[var(--widget-border)] bg-[var(--widget-panel)] shadow-[0_18px_48px_rgba(36,33,24,0.08)]'
            : 'bg-transparent'
        ].join(' ')}
      >
        <WidgetShellBar onMinimize={onMinimize} onMovePointerDown={onMovePointerDown} />
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          {turns.length === 0 ? (
            <p className="text-[13px] leading-5 text-[var(--widget-muted)]">
              Start a compact session. The widget reuses the shared runtime without copying the web shell.
            </p>
          ) : (
            <div className="space-y-2.5">
              {turns.map((turn) => (
                <div key={turn.id} className="space-y-1">
                  {turn.userText ? (
                    <div className="rounded-xl bg-amber-100 px-2.5 py-1.5 text-[13px] leading-5 text-stone-900">
                      {turn.userText}
                    </div>
                  ) : null}
                  <div className="rounded-xl border border-[var(--widget-border)] bg-white px-2.5 py-2">
                    {turn.notice ? (
                      <div className="mb-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-4 text-amber-800">
                        {turn.notice.message}
                      </div>
                    ) : null}
                    {turn.assistantContent ? (
                      <AssistantContent
                        content={turn.assistantContent}
                        className="widget-prose text-[13px] leading-5"
                        turnId={turn.id}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="border-t border-[var(--widget-border)] px-3 py-2.5">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (!isCoolingDown) void handleSubmit()
              }
            }}
            placeholder="Ask something current, compare options, or continue the thread."
            rows={2}
            className="min-h-16 max-h-28 w-full rounded-xl border border-[var(--widget-border)] bg-white px-3 py-2 text-[13px] leading-5 outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Settings"
                onClick={() => setSettingsOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--widget-border)] bg-white text-[var(--widget-muted)] transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-[var(--widget-text)]"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                  <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              </button>
              {!token ? (
                <button
                  type="button"
                  aria-label="Sign in with GitHub"
                  onClick={() => setSettingsOpen(true)}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--widget-border)] bg-white px-2 text-[11px] text-[var(--widget-muted)] transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-[var(--widget-text)]"
                >
                  <GitHubMark />
                  Sign in
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void resetConversation()}
                className="inline-flex h-8 items-center rounded-md border border-[var(--widget-border)] bg-white px-2 text-[12px] text-[var(--widget-muted)] transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
              >
                Reset
              </button>
              {isRetryPending && isCoolingDown ? (
                <Button size="sm" variant="secondary" onClick={cancelRetry}>
                  Cancel retry
                </Button>
              ) : null}
              <Button
                onClick={() => void handleSubmit()}
                disabled={isRunning || isCoolingDown || !prompt.trim()}
              >
                {submitLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>
      {settingsOpen ? (
        <Suspense fallback={null}>
          <LazyBrowserSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
        </Suspense>
      ) : null}
    </div>
  )
}

export const WidgetPage = () => {
  const viewMode = resolveWidgetViewMode(window.location.search)
  const [layout, setLayout] = useState<WidgetLayout>(() => loadStandaloneLayout())
  const [hostMinimized, setHostMinimized] = useState(
    () => resolveWidgetWindowMode(window.location.search) === 'minimized'
  )
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number, startY: number, startLayout: WidgetLayout } | null>(null)
  const resizeRef = useRef<{ startX: number, startY: number, startLayout: WidgetLayout } | null>(null)

  const isStandalone = viewMode === 'standalone'
  const isMinimized = isStandalone ? layout.minimized : hostMinimized

  const handleStandaloneMovePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLayout: layout
    }
    setIsDragging(true)
  }

  const handleHostMovePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.parent === window) {
      return
    }

    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    const postDragEvent = (phase: 'start' | 'move' | 'end', clientX: number, clientY: number) => {
      window.parent.postMessage(
        {
          type: 'tinytinkerer.widget.drag',
          phase,
          clientX,
          clientY
        },
        window.location.origin
      )
    }

    postDragEvent('start', event.clientX, event.clientY)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      postDragEvent('move', moveEvent.clientX, moveEvent.clientY)
    }

    const handlePointerEnd = (endEvent: PointerEvent) => {
      postDragEvent('end', endEvent.clientX, endEvent.clientY)
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

  if (!isStandalone) {
    return isMinimized ? (
      <WidgetLauncher onRestore={handleRestore} />
    ) : (
      <WidgetSurface
        framed={false}
        onMinimize={handleMinimize}
        onMovePointerDown={handleHostMovePointerDown}
      />
    )
  }

  return (
    <div className="widget-stage">
      <div
        className="widget-floating-shell"
        data-dragging={isDragging ? 'true' : 'false'}
        data-minimized={isMinimized ? 'true' : 'false'}
        style={{
          left: layout.x,
          top: layout.y,
          width: isMinimized ? WIDGET_MINIMIZED_SIZE : layout.width,
          height: isMinimized ? WIDGET_MINIMIZED_SIZE : layout.height
        }}
      >
        <div className="widget-shell-body">
          {isMinimized ? (
            <WidgetLauncher onRestore={handleRestore} />
          ) : (
            <WidgetSurface
              onMinimize={handleMinimize}
              onMovePointerDown={handleStandaloneMovePointerDown}
              framed={false}
            />
          )}
        </div>
        {!isMinimized ? (
          <button
            type="button"
            className="widget-shell-resize"
            aria-label="Resize widget"
            title="Resize widget"
            onPointerDown={(event) => {
              resizeRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                startLayout: layout
              }
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
