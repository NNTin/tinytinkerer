/**
 * The one surface that draws an app's pre-send disclosure (issue #481).
 *
 * Mounted by `BrowserAppShell`, so it sits above every surface of that app —
 * the floating widget, the docked panel, and #472's Office later — and each of
 * them gets the gate without knowing it exists. That placement is the whole
 * point: the alternative was a conditional in `floating-chat-surface.tsx` and
 * another in `docked-chat-surface.tsx`, which is two implementations of one
 * rule and a third waiting to be forgotten.
 *
 * It renders nothing at all for an app with no disclosure configured, which is
 * every product app today.
 *
 * NOTE on multiplicity: this is per-SHELL, and several shells can share one
 * `BrowserApp` (every `<LiveLab>` on a documentation page mounts its own shell
 * over the one shared lab app). An app that declares a disclosure must
 * therefore mount exactly one shell — which the documentation assistant does,
 * from `assistant-runtime-client.tsx`.
 */
import { useState, type ReactNode } from 'react'
import { usePreSendDisclosureStore } from './pre-send-disclosure'
import { PrivacyPolicyDialog } from './telemetry/privacy-policy-dialog'
import { useDialogEscape, useDialogFocus } from './use-dialog-focus'

export const PreSendDisclosureHost = (): ReactNode => {
  const [policyOpen, setPolicyOpen] = useState(false)
  const disclosure = usePreSendDisclosureStore((state) => state.disclosure)
  const pending = usePreSendDisclosureStore((state) => state.pending)
  const accept = usePreSendDisclosureStore((state) => state.accept)
  const dismiss = usePreSendDisclosureStore((state) => state.dismiss)

  const open = Boolean(disclosure && pending)
  // The shared managers every aria-modal dialog in this package uses: focus in
  // on open, a Tab trap at the boundaries, focus restored to the composer on
  // close. Dismissing is safe by construction — nothing was sent, and the
  // composer still holds the reader's text.
  const dialogRef = useDialogFocus(open)
  useDialogEscape(open, dismiss)

  if (!disclosure || !open) return null

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className="settings-overlay absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        data-state="open"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={disclosure.title}
        tabIndex={-1}
        className="settings-content fixed left-1/2 top-1/2 z-[70] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl outline-none"
        data-state="open"
      >
        <h2 className="text-base font-semibold text-[var(--text-strong)]">{disclosure.title}</h2>
        {disclosure.paragraphs.map((paragraph) => (
          <p key={paragraph} className="mt-3 text-sm leading-relaxed text-[var(--text)]">
            {paragraph}
          </p>
        ))}
        {disclosure.learnMore ? (
          <button
            type="button"
            onClick={() => setPolicyOpen(true)}
            className="mt-2 text-sm font-medium text-[var(--link)] underline-offset-2 hover:underline"
          >
            {disclosure.learnMore.label}
          </button>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] transition-colors hover:bg-[var(--panel-hover)]"
          >
            {disclosure.cancelLabel ?? 'Not now'}
          </button>
          <button
            type="button"
            onClick={() => void accept()}
            className="rounded-lg bg-[var(--accent-strong)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            {disclosure.acceptLabel ?? 'Send'}
          </button>
        </div>
      </div>
      {/* Opened in place rather than navigated to: on a documentation site a
          navigation would discard the message still sitting in the composer. */}
      <PrivacyPolicyDialog open={policyOpen} onClose={() => setPolicyOpen(false)} />
    </div>
  )
}
