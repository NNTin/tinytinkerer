import { HumanPromptControls } from './human-prompt-host'
import { useHumanPromptPresentation } from './human-prompt-presentation'

// The composer-docked presentation of a human prompt (issue #85): instead of a
// centered modal, the question + answer controls dock directly above the message box,
// so the conversation stays visible and the user answers right where they type. Each
// shell places this slot immediately above its composer (the composer is hand-rolled
// per shell, so there is no single mount point) — exactly how the shells already place
// ContextGaugeSlot. It renders only when the head-of-queue prompt's resolved
// presentation is `composer`; otherwise (modal, or no pending prompt) it draws nothing.
// Non-modal: there is no overlay, and the underlying composer stays visible (disabled,
// since the run is blocked on this answer). The shared HumanPromptControls render the
// actions / free-text / Skip; dismissal (Skip / Escape / a host-forced settle on abort)
// resolves `{ kind: 'dismissed' }` exactly like the modal.
export const HumanPromptComposerDock = () => {
  const { pending, presentation } = useHumanPromptPresentation()

  if (!pending || presentation !== 'composer') {
    return null
  }

  const { view } = pending

  return (
    <section
      role={view.role}
      aria-label={view.ariaLabel}
      className="mb-2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm"
    >
      <div className="border-b border-[var(--border)] px-6 py-4">
        <h2 className="text-base font-semibold text-stone-900">{view.title}</h2>
        {view.description ? (
          <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{view.description}</p>
        ) : null}
      </div>
      <HumanPromptControls pending={pending} />
    </section>
  )
}
