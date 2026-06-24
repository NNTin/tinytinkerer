// The floating "↓ New messages" pill (Q2). Shared so every shell renders the
// same affordance; the shell positions it (absolute) within its conversation
// container. Hidden unless `visible`.
export const JumpToLatestButton = ({
  visible,
  onClick,
  className
}: {
  visible: boolean
  onClick: () => void
  className?: string
}) => {
  if (!visible) {
    return null
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-xs font-medium text-stone-700 shadow-md transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span aria-hidden="true">↓</span>
      New messages
    </button>
  )
}
