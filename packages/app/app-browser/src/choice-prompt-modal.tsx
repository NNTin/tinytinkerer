import { useEffect, useState } from 'react'
import { useChoiceStore, type PendingChoice } from './choice-service'

// Renders the head-of-queue choice poll (issue #85) as a modal and settles it with
// the user's answer. Unlike the permission modal — which formats arbitrary tool
// input and needs a plugin-emitted view-model — the choice request is
// self-describing (`{ question, options, allowCustom }`), so this generic host
// renderer draws it directly. The plugin ships no React. Mounted once per browser
// shell (web/widget/mobile), beside <PermissionModal />.
export const ChoicePromptModal = () => {
  const pending = useChoiceStore((state): PendingChoice | undefined => state.queue[0])

  // Free-text answer, reset whenever the head-of-queue poll changes so a typed
  // answer never leaks from one poll into the next.
  const [customText, setCustomText] = useState('')
  useEffect(() => {
    setCustomText('')
  }, [pending?.id])

  // Dismissing the poll (overlay click / Escape) resolves `dismissed` — a normal
  // "the user declined" outcome the model can react to, not a tool failure.
  useEffect(() => {
    if (!pending) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        pending.resolve({ kind: 'dismissed' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending])

  if (!pending) {
    return null
  }

  const { request, resolve } = pending
  const trimmedCustom = customText.trim()

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Dismiss question"
        className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        onClick={() => resolve({ kind: 'dismissed' })}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assistant question"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
      >
        <div className="border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-stone-900">The assistant has a question</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{request.question}</p>
        </div>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto px-6 py-5">
          {request.options.map((option, index) => (
            <button
              key={`${index}-${option}`}
              type="button"
              onClick={() => resolve({ kind: 'option', value: option })}
              className="flex w-full items-center rounded-md border border-stone-200 bg-white px-4 py-2 text-left text-sm text-stone-800 transition-colors hover:border-stone-300 hover:bg-stone-50"
            >
              {option}
            </button>
          ))}
        </div>

        {request.allowCustom ? (
          <div className="space-y-2 border-t border-[var(--border)] px-6 py-4">
            <label
              htmlFor="tt-choice-custom"
              className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]"
            >
              Or type your own answer
            </label>
            <div className="flex gap-2">
              <input
                id="tt-choice-custom"
                type="text"
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && trimmedCustom.length > 0) {
                    resolve({ kind: 'custom', text: trimmedCustom })
                  }
                }}
                placeholder="Type an answer…"
                className="flex-1 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-stone-400"
              />
              <button
                type="button"
                disabled={trimmedCustom.length === 0}
                onClick={() => resolve({ kind: 'custom', text: trimmedCustom })}
                className="inline-flex items-center rounded-md border border-stone-800 bg-stone-900 px-4 py-2 text-sm text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-400"
              >
                Send
              </button>
            </div>
          </div>
        ) : null}

        {/* Always-visible Skip: makes the "I won't answer" exit discoverable (the
            same `dismissed` outcome as Escape/overlay), so the composer is never
            silently blocked waiting on a poll the user has no intent to answer. */}
        <div className="flex justify-end border-t border-[var(--border)] px-6 py-4">
          <button
            type="button"
            onClick={() => resolve({ kind: 'dismissed' })}
            className="inline-flex items-center rounded-md border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
