import { useEffect, useState } from 'react'
import type { PixelAgentsActivityStatus } from '@tinytinkerer/pixel-agents'

export type ConversationSwitcherItem = {
  id: string
  title: string
  status: PixelAgentsActivityStatus
}

export type ConversationSwitcherProps = {
  conversations: readonly ConversationSwitcherItem[]
  activeConversationId: string | undefined
  onSelect: (conversationId: string) => void
  onCreate: () => void
  onDelete: (conversationId: string) => void
  /**
   * BEM block for this instance's class names, so one implementation can be
   * styled per host. Every rule lives in `css/custom.css` — a Tailwind class
   * written in docs-owned TSX generates nothing, since `tailwind.css`'s
   * `@source` covers `packages/` only.
   */
  block?: string
  /** Landmark name. The live labs manage demo conversations; #472's sidebar
   * Office manages the reader's real assistant conversations, and a screen
   * reader listing both on one page must be able to tell them apart. */
  label?: string
  /** Same reason: two "New conversation" buttons on one page are ambiguous to
   * a reader and to `getByRole` alike. */
  createLabel?: string
}

const STATUS_LABEL: Record<PixelAgentsActivityStatus, string> = {
  'running-tool': 'Using a tool…',
  running: 'Running…',
  'awaiting-input': 'Awaiting input',
  failed: 'Last run failed',
  completed: 'Completed',
  idle: 'Idle'
}

// How long an armed (but unconfirmed) delete stays armed before resetting —
// long enough to read the confirm label, short enough that a visitor who
// walked away doesn't come back to a live landmine.
const DELETE_ARM_TIMEOUT_MS = 4000

// The always-present, fully keyboard/screen-reader-operable surface for
// managing conversations — the live labs' demo conversations (issue #452) and,
// since issue #472, the documentation assistant's own in the sidebar. Every
// control is a native <button>, so it needs no extra ARIA wiring to be
// reachable — the only custom semantics are `aria-current` for the active
// conversation and the arm-then-confirm delete flow's `aria-pressed`/relabeled
// button (the same two-step-no-window.confirm shape used elsewhere in the
// product; see pixel-agents-stage.tsx's closeAgent handling).
//
// It talks to its host's conversation actions directly, never through the
// office's postMessage bridge, which is what keeps it working when the office
// cannot run at all.
export const ConversationSwitcher = ({
  conversations,
  activeConversationId,
  onSelect,
  onCreate,
  onDelete,
  block = 'pixel-agents-lab',
  label = 'Demo conversations',
  createLabel = 'New conversation'
}: ConversationSwitcherProps): React.JSX.Element => {
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (armedDeleteId === null) return
    const timer = window.setTimeout(() => setArmedDeleteId(null), DELETE_ARM_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [armedDeleteId])

  const handleDeleteClick = (conversationId: string): void => {
    if (armedDeleteId === conversationId) {
      setArmedDeleteId(null)
      onDelete(conversationId)
      return
    }
    setArmedDeleteId(conversationId)
  }

  return (
    <div className={`${block}__switcher`} role="group" aria-label={label}>
      <ul className={`${block}__switcher-list`}>
        {conversations.map((conversation) => {
          const isActive = conversation.id === activeConversationId
          const isArmed = armedDeleteId === conversation.id
          return (
            <li key={conversation.id} className={`${block}__switcher-item`}>
              <button
                type="button"
                className={`${block}__switcher-select`}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => {
                  setArmedDeleteId(null)
                  onSelect(conversation.id)
                }}
              >
                <span className={`${block}__switcher-title`}>{conversation.title}</span>
                <span className={`${block}__switcher-status`}>
                  {STATUS_LABEL[conversation.status]}
                </span>
              </button>
              <button
                type="button"
                className={`${block}__switcher-delete`}
                aria-pressed={isArmed}
                aria-label={
                  isArmed
                    ? `Confirm deleting conversation "${conversation.title}"`
                    : `Delete conversation "${conversation.title}"`
                }
                onClick={() => handleDeleteClick(conversation.id)}
              >
                {isArmed ? 'Confirm delete?' : 'Delete'}
              </button>
            </li>
          )
        })}
      </ul>
      <button type="button" className={`${block}__switcher-create`} onClick={onCreate}>
        {createLabel}
      </button>
    </div>
  )
}
