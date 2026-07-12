import { useEffect, useState } from 'react'
import { type PendingHumanPrompt } from './human-prompt-bridge'
import { useDialogEscape } from './use-dialog-focus'

// The interactive answer affordances shared by every presentation (issue #85): the
// action buttons, the optional free-text answer, and the explicit dismiss ("Skip").
// Escape also dismisses. Both the modal and the composer dock render this; only the
// chrome around it (overlay vs docked bar) differs. The presentation gate guarantees
// only one is mounted for a given prompt, so only one useDialogEscape listener is active.
//
// Kept in its own module (free of the content-code CodeMirror view the modal draws) so
// the composer dock — which is eager in every chat surface — can render the controls
// without dragging the heavier modal (and its content-code dependency) into the chat
// route chunk. The modal itself stays lazy (see ./lazy-human-prompt-host).
export const HumanPromptControls = ({ pending }: { pending: PendingHumanPrompt }) => {
  const { view, resolve } = pending

  // Free-text answer, reset whenever the head-of-queue prompt changes so a typed answer
  // never leaks from one prompt into the next.
  const [customText, setCustomText] = useState('')
  useEffect(() => {
    setCustomText('')
  }, [pending.id])

  useDialogEscape(true, () => resolve({ kind: 'dismissed' }))

  const trimmedCustom = customText.trim()

  return (
    <>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto px-6 py-5">
        {view.actions.map((action, index) => (
          <button
            key={`${index}-${action.id}`}
            type="button"
            // Initial focus lands on the first action — for the permission prompt that
            // is Deny, the least destructive choice, per the alertdialog pattern (issue
            // #353). Inert in the composer-dock presentation.
            {...(index === 0 ? { 'data-autofocus': true } : {})}
            onClick={() => resolve({ kind: 'action', id: action.id })}
            className={
              action.tone === 'primary'
                ? 'flex w-full items-center justify-center rounded-md border border-stone-800 bg-stone-900 px-4 py-2 text-sm text-white transition-colors hover:bg-stone-700'
                : 'flex w-full items-center rounded-md border border-stone-200 bg-white px-4 py-2 text-left text-sm text-stone-800 transition-colors hover:border-stone-300 hover:bg-stone-50'
            }
          >
            {action.label}
          </button>
        ))}
      </div>

      {view.allowCustom ? (
        <div className="space-y-2 border-t border-[var(--border)] px-6 py-4">
          <label
            htmlFor="tt-prompt-custom"
            className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]"
          >
            Or type your own answer
          </label>
          <div className="flex gap-2">
            <input
              id="tt-prompt-custom"
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

      {/* An explicit dismiss button when the view asks for one (e.g. a poll's "Skip"):
          makes the "I won't answer" exit discoverable — the same `dismissed` outcome as
          Escape/overlay — so the composer is never silently blocked. */}
      {view.dismissAction ? (
        <div className="flex justify-end border-t border-[var(--border)] px-6 py-4">
          <button
            type="button"
            onClick={() => resolve({ kind: 'dismissed' })}
            className="inline-flex items-center rounded-md border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50"
          >
            {view.dismissAction.label}
          </button>
        </div>
      ) : null}
    </>
  )
}
