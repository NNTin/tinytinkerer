import { useEffect } from 'react'
import { usePermissionStore, type PendingPermission } from './permission-service'

// Reason recorded when the user dismisses the prompt (overlay click / Escape /
// Deny) rather than allowing the tool. The plugin wraps this into the runtime's
// "Tool execution blocked: …" message, naming the denied tool.
const DENY_REASON = 'Denied by user'

const formatInput = (input: Record<string, unknown>): string => {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    // Inputs are normally plain JSON, but guard against a non-serializable value
    // (e.g. a cyclic object) so rendering the prompt can never throw.
    return '(input could not be displayed)'
  }
}

// Renders the head-of-queue permission request as a confirmation dialog and
// settles it with the user's choice. Mirrors the settings modal's overlay/dialog
// markup. Dismissing the dialog (overlay click or Escape) denies, the safe
// default for a permission prompt.
export const PermissionModal = () => {
  const pending = usePermissionStore(
    (state): PendingPermission | undefined => state.queue[0]
  )

  useEffect(() => {
    if (!pending) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        pending.resolve({ allow: false, reason: DENY_REASON })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending])

  if (!pending) {
    return null
  }

  const { request, resolve } = pending
  const allow = () => resolve({ allow: true })
  const deny = () => resolve({ allow: false, reason: DENY_REASON })

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Deny tool"
        className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        onClick={deny}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Tool permission request"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
      >
        <div className="border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-stone-900">
            Allow this tool to run?
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            The assistant wants to run a tool. Review it and choose whether to
            allow it.
          </p>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Tool
            </p>
            <p className="mt-1 break-all font-mono text-sm text-stone-800">
              {request.toolId}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Input
            </p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
              {formatInput(request.input)}
            </pre>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
          <button
            type="button"
            onClick={deny}
            className="inline-flex items-center rounded-md border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={allow}
            className="inline-flex items-center rounded-md border border-stone-800 bg-stone-900 px-4 py-2 text-sm text-white transition-colors hover:bg-stone-700"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
