import { useEffect } from 'react'
import { PRIVACY_POLICY } from './privacy-policy.generated'

export const PrivacyPolicyDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

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
        role="dialog"
        aria-modal="true"
        aria-label="Privacy & Telemetry"
        className="settings-content fixed left-1/2 top-1/2 z-[70] flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
        data-state="open"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-stone-900">Privacy &amp; Telemetry</h2>
          <button
            type="button"
            aria-label="Close privacy policy"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-stone-700">
            {PRIVACY_POLICY}
          </pre>
        </div>
      </div>
    </div>
  )
}
