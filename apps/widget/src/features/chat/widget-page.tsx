import {
  buildTurns,
  buildGitHubLoginUrl,
  fetchStatus,
  SUPPORTED_MODELS,
  useAuthStore,
  useChatStore,
  useSettingsStore,
  type SystemStatus
} from '@tinytinkerer/app-browser'
import { Button } from '@tinytinkerer/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownContent } from './markdown-content'

const fallbackStatus: SystemStatus = {
  auth: { state: 'offline', detail: 'Unavailable' },
  models: { state: 'offline', detail: 'Unavailable' },
  search: { state: 'offline', detail: 'Unavailable' }
}

let chatStoreInitialized = false

export const WidgetPage = () => {
  const events = useChatStore((state) => state.events)
  const streamingText = useChatStore((state) => state.streamingText)
  const isRunning = useChatStore((state) => state.isRunning)
  const sendPrompt = useChatStore((state) => state.sendPrompt)
  const resetConversation = useChatStore((state) => state.resetConversation)

  const token = useAuthStore((state) => state.token)
  const setToken = useAuthStore((state) => state.setToken)
  const clearToken = useAuthStore((state) => state.clearToken)

  const selectedModel = useSettingsStore((state) => state.selectedModel)
  const setSelectedModel = useSettingsStore((state) => state.setSelectedModel)
  const searchEnabled = useSettingsStore((state) => state.searchEnabled)
  const setSearchEnabled = useSettingsStore((state) => state.setSearchEnabled)

  const [prompt, setPrompt] = useState('')
  const [showPat, setShowPat] = useState(false)
  const [patValue, setPatValue] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chatStoreInitialized) {
      chatStoreInitialized = true
      void useChatStore.getState().initialize()
    }
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [events, streamingText])

  const { data } = useQuery({
    queryKey: ['widget-status'],
    queryFn: fetchStatus,
    refetchInterval: 15_000
  })

  const turns = useMemo(() => buildTurns(events, streamingText), [events, streamingText])
  const loginUrl = buildGitHubLoginUrl()
  const status = data ?? fallbackStatus

  const handleSubmit = async () => {
    const trimmed = prompt.trim()
    if (!trimmed || isRunning) {
      return
    }

    await sendPrompt(trimmed)
    setPrompt('')
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
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 py-4">
      <div className="rounded-[1.5rem] border border-[var(--widget-border)] bg-[var(--widget-panel)] shadow-[0_18px_48px_rgba(36,33,24,0.08)]">
        <div className="border-b border-[var(--widget-border)] px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--widget-muted)]">
                Embedded Workspace
              </p>
              <h1 className="mt-1 text-lg font-semibold">tinytinkerer widget</h1>
            </div>
            <div className="rounded-full border border-[var(--widget-border)] px-2.5 py-1 text-[11px] text-[var(--widget-muted)]">
              {status.models.state}
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
                {SUPPORTED_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center justify-between rounded-xl border border-[var(--widget-border)] bg-white px-3 py-2 text-sm text-[var(--widget-text)]">
              <span>
                <span className="block text-xs text-[var(--widget-muted)]">Web search</span>
                <span>{searchEnabled ? 'Enabled' : 'Disabled'}</span>
              </span>
              <input
                type="checkbox"
                checked={searchEnabled}
                onChange={(event) => void setSearchEnabled(event.target.checked)}
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {token ? (
              <Button size="sm" variant="ghost" onClick={() => void clearToken()}>
                Sign out
              </Button>
            ) : (
              <>
                {loginUrl ? (
                  <a
                    href={loginUrl}
                    className="inline-flex items-center rounded-full bg-stone-900 px-3 py-1.5 text-xs text-white"
                  >
                    Sign in with GitHub
                  </a>
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

        <div className="max-h-[48vh] overflow-y-auto px-4 py-4">
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
                    <MarkdownContent
                      content={
                        turn.assistantText ||
                        turn.systemMessage ||
                        turn.errorMessage ||
                        turn.rateLimitMessage ||
                        '...'
                      }
                    />
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
                void handleSubmit()
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
            <Button onClick={() => void handleSubmit()} disabled={isRunning}>
              {isRunning ? 'Thinking...' : 'Send'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
