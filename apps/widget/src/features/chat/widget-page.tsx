import {
  AssistantContent,
  TINYTINKERER_BRAND_ASSET_URLS,
  useChatSurfaceController,
  useSettingsSurfaceController
} from '@tinytinkerer/app-browser'
import { Button, GitHubMark } from '@tinytinkerer/ui'
import { useEffect, useRef, useState } from 'react'
import { resolveWidgetViewMode, resolveWidgetWindowMode } from '../../runtime-config'

const STANDALONE_LAYOUT_KEY = 'tinytinkerer:widget-layout:v1'
const WIDGET_DEFAULT_WIDTH = 400
const WIDGET_DEFAULT_HEIGHT = 680
const WIDGET_MIN_WIDTH = 320
const WIDGET_MIN_HEIGHT = 420
const WIDGET_MINIMIZED_SIZE = 64
const WIDGET_SAFE_MARGIN = 24
const WIDGET_GRIP_HEIGHT = 14

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
    Math.max(WIDGET_MIN_HEIGHT, window.innerHeight - WIDGET_SAFE_MARGIN * 2 - WIDGET_GRIP_HEIGHT)
  )
  const boxWidth = layout.minimized ? WIDGET_MINIMIZED_SIZE : width
  const boxHeight = (layout.minimized ? WIDGET_MINIMIZED_SIZE : height) + WIDGET_GRIP_HEIGHT

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
    y: Math.round(window.innerHeight - WIDGET_DEFAULT_HEIGHT - WIDGET_GRIP_HEIGHT - 32),
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

const WidgetSurface = ({ onMinimize }: { onMinimize: () => void }) => {
  const {
    events,
    streamingText,
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
    token,
    setToken,
    clearToken,
    canStartGitHubOAuth,
    startGitHubOAuth,
    user,
    models,
    selectedModel,
    setSelectedModel,
    searchEnabled,
    setSearchEnabled,
    effectiveStatus,
    searchUnavailable
  } = useSettingsSurfaceController()
  const [prompt, setPrompt] = useState('')
  const [showPat, setShowPat] = useState(false)
  const [patValue, setPatValue] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [events, streamingText])

  const handleSubmit = async () => {
    const didSend = await submitPrompt(prompt)
    if (didSend) {
      setPrompt('')
    }
  }

  const handlePatSave = async () => {
    const trimmed = patValue.trim()
    if (!trimmed) {
      return
    }

    await setToken(trimmed)
    setPatValue('')
    setShowPat(false)
  }

  return (
    <div className="flex h-full w-full flex-col px-4 py-4">
      <div className="flex h-full min-h-0 flex-col rounded-[1.5rem] border border-[var(--widget-border)] bg-[var(--widget-panel)] shadow-[0_18px_48px_rgba(36,33,24,0.08)]">
        <div className="border-b border-[var(--widget-border)] px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--widget-muted)]">
                Embedded Workspace
              </p>
              <h1 className="mt-1 text-lg font-semibold">tinytinkerer widget</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-full border border-[var(--widget-border)] px-2.5 py-1 text-[11px] text-[var(--widget-muted)]">
                {effectiveStatus.models.state}
              </div>
              <button
                type="button"
                onClick={onMinimize}
                className="rounded-full border border-[var(--widget-border)] px-2.5 py-1 text-[11px] text-[var(--widget-muted)]"
              >
                Minimize
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--widget-muted)]">
              Model
              <select
                value={selectedModel}
                onChange={(event) => void setSelectedModel(event.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--widget-border)] bg-white px-3 py-2 text-sm text-[var(--widget-text)]"
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center justify-between rounded-xl border border-[var(--widget-border)] bg-white px-3 py-2 text-sm text-[var(--widget-text)]">
              <span>
                <span className="block text-xs text-[var(--widget-muted)]">Web search</span>
                <span>{searchUnavailable ? 'Unavailable' : searchEnabled ? 'Enabled' : 'Disabled'}</span>
              </span>
              <input
                type="checkbox"
                checked={searchEnabled}
                disabled={searchUnavailable}
                onChange={(event) => void setSearchEnabled(event.target.checked)}
              />
            </label>
          </div>

          {searchUnavailable ? (
            <p className="mt-2 text-xs text-[var(--widget-muted)]">{effectiveStatus.search.detail}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {token ? (
              <div className="flex flex-1 items-center justify-between gap-2">
                {user ? (
                  <div className="min-w-0 flex items-center gap-2">
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.login}
                        className="h-6 w-6 shrink-0 rounded-full border border-[var(--widget-border)]"
                      />
                    ) : null}
                    <span className="truncate text-xs text-[var(--widget-muted)]">@{user.login}</span>
                  </div>
                ) : (
                  <span className="text-xs text-[var(--widget-muted)]">Signed in</span>
                )}
                <Button size="sm" variant="ghost" onClick={() => void clearToken()}>
                  Sign out
                </Button>
              </div>
            ) : (
              <>
                {canStartGitHubOAuth ? (
                  <button
                    type="button"
                    onClick={() => startGitHubOAuth()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 px-3 py-1.5 text-xs text-white"
                  >
                    <GitHubMark />
                    Sign in with GitHub
                  </button>
                ) : null}
                {showPat ? (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <input
                      type="password"
                      value={patValue}
                      onChange={(event) => setPatValue(event.target.value)}
                      placeholder="GitHub PAT"
                      className="min-w-0 flex-1 rounded-full border border-[var(--widget-border)] px-3 py-1.5 text-xs"
                    />
                    <Button size="sm" onClick={() => void handlePatSave()}>
                      Save
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setShowPat(true)}>
                    Use PAT
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {turns.length === 0 ? (
            <p className="text-sm text-[var(--widget-muted)]">
              Start a compact session. The widget reuses the shared runtime without copying the web shell.
            </p>
          ) : (
            <div className="space-y-4">
              {turns.map((turn) => (
                <div key={turn.id} className="space-y-2">
                  {turn.userText ? (
                    <div className="rounded-2xl bg-amber-100 px-3 py-2 text-sm text-stone-900">
                      {turn.userText}
                    </div>
                  ) : null}
                  <div className="rounded-2xl border border-[var(--widget-border)] bg-white px-3 py-3">
                    {turn.notice ? (
                      <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {turn.notice.message}
                      </div>
                    ) : null}
                    {turn.assistantText ? (
                      <AssistantContent content={turn.assistantText} className="widget-prose text-sm" />
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="border-t border-[var(--widget-border)] px-4 py-4">
          <label className="block text-xs text-[var(--widget-muted)]">Prompt</label>
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
            className="mt-2 min-h-28 w-full rounded-2xl border border-[var(--widget-border)] bg-white px-3 py-3 text-sm outline-none"
          />
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => void resetConversation()}
              className="text-xs text-[var(--widget-muted)]"
            >
              Clear conversation
            </button>
            <div className="flex items-center gap-2">
              {isRetryPending && isCoolingDown ? (
                <Button size="sm" variant="secondary" onClick={cancelRetry}>
                  Cancel retry
                </Button>
              ) : null}
              <Button onClick={() => void handleSubmit()} disabled={isRunning || isCoolingDown}>
                {submitLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>
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
      <WidgetSurface onMinimize={handleMinimize} />
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
          height: (isMinimized ? WIDGET_MINIMIZED_SIZE : layout.height) + WIDGET_GRIP_HEIGHT
        }}
      >
        <button
          type="button"
          className="widget-shell-grip"
          aria-label="Move widget"
          title="Move widget"
          onPointerDown={(event) => {
            dragRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              startLayout: layout
            }
            setIsDragging(true)
          }}
        />
        <div className="widget-shell-body">
          {isMinimized ? <WidgetLauncher onRestore={handleRestore} /> : <WidgetSurface onMinimize={handleMinimize} />}
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
