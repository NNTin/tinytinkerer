import { useEffect } from 'react'
import { MarkdownDocument } from '../markdown-document'
import { useDialogEscape, useDialogFocus } from '../use-dialog-focus'
import { PRIVACY_POLICY } from './privacy-policy.generated'

export const PrivacyPolicyDialog = ({
  open,
  onClose,
  onOpen
}: {
  open: boolean
  onClose: () => void
  onOpen?: () => void
}) => {
  useEffect(() => {
    if (!open) {
      return
    }
    onOpen?.()
  }, [onOpen, open])

  // The shared dialog managers, not a private Escape listener (issue #481
  // review, finding 2). This dialog is routinely opened OVER another one — the
  // telemetry consent notice and the pre-send disclosure both link to it — and
  // on its own it moved no focus, trapped nothing, and closed on the very same
  // Escape event as whatever was underneath. The stack in `use-dialog-focus`
  // makes it the only dialog answering while it is on top, and marks the one
  // below `inert` so a reader cannot Tab back into a dialog they cannot see.
  const dialogRef = useDialogFocus(open)
  useDialogEscape(open, onClose)

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label="Close privacy policy"
        className="settings-overlay absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        data-state="open"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Privacy & Telemetry"
        className="settings-content fixed left-1/2 top-1/2 z-[70] flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
        data-state="open"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-[var(--text-strong)]">
            Privacy &amp; Telemetry
          </h2>
          <button
            type="button"
            aria-label="Close privacy policy"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--panel-hover)] hover:text-[var(--text-strong)]"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          <MarkdownDocument markdown={PRIVACY_POLICY} />
        </div>
      </div>
    </div>
  )
}
