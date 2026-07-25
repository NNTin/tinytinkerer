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
// managing demo conversations (issue #452). Every control is a native
// <button>, so it needs no extra ARIA wiring to be reachable — the only
// custom semantics are `aria-current` for the active conversation and the
// arm-then-confirm delete flow's `aria-pressed`/relabeled button (the same
// two-step-no-window.confirm shape used elsewhere in the product; see
// pixel-agents-stage.tsx's closeAgent handling).
export const ConversationSwitcher = ({
  conversations,
  activeConversationId,
  onSelect,
  onCreate,
  onDelete
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
    <div className="pixel-agents-lab__switcher" role="group" aria-label="Demo conversations">
      <ul className="pixel-agents-lab__switcher-list">
        {conversations.map((conversation) => {
          const isActive = conversation.id === activeConversationId
          const isArmed = armedDeleteId === conversation.id
          return (
            <li key={conversation.id} className="pixel-agents-lab__switcher-item">
              <button
                type="button"
                className="pixel-agents-lab__switcher-select"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => {
                  setArmedDeleteId(null)
                  onSelect(conversation.id)
                }}
              >
                <span className="pixel-agents-lab__switcher-title">{conversation.title}</span>
                <span className="pixel-agents-lab__switcher-status">
                  {STATUS_LABEL[conversation.status]}
                </span>
              </button>
              <button
                type="button"
                className="pixel-agents-lab__switcher-delete"
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
      <button type="button" className="pixel-agents-lab__switcher-create" onClick={onCreate}>
        New conversation
      </button>
    </div>
  )
}
