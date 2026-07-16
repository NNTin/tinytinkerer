import { useEffect, useRef, useState } from 'react'
// Icons come straight from react-icons (not @tinytinkerer/ui): app-browser must
// not depend on the ui package (see floating-chat-surface's boundary comment) —
// react-icons is the same source ui re-exports.
import { FaChevronDown, FaPlus, FaXmark } from 'react-icons/fa6'
import type { ConversationSummary } from '../surfaces'
import { useDialogEscape } from '../use-dialog-focus'

export type ConversationSwitcherProps = {
  conversations: ConversationSummary[]
  activeConversationId: string | undefined
  selectConversation: (conversationId: string) => Promise<void>
  startNewConversation: () => Promise<void>
  deleteConversation: (conversationId: string) => Promise<void>
  // Trigger button classes, so the floating and docked headers can match their
  // own existing icon-button chrome (square vs pill controls, widget vs
  // comfortable palette) instead of this component hard-coding either one.
  triggerClassName: string
}

// Header control for switching between conversations (issue #430), rendered
// next to the existing "Reset conversation" button in both chat surfaces. A
// compact trigger shows the active conversation's title, a chevron, and a
// badge counting OTHER conversations currently running; clicking it opens a
// simple absolutely-positioned listbox (no host-provided dropdown primitive
// exists to reuse — the settings/tool-tree panels are full centered modals,
// not a fit for a small header menu) with one row per conversation, a "New
// conversation" action, and a two-click delete-confirm per row.
//
// Surfaces render this through LazyConversationSwitcher (its own chunk, like
// the settings modal) to keep the tightly-budgeted chat-surface chunk flat.
export const ConversationSwitcher = ({
  conversations,
  activeConversationId,
  selectConversation,
  startNewConversation,
  deleteConversation,
  triggerClassName
}: ConversationSwitcherProps) => {
  const [open, setOpen] = useState(false)
  // Two-click delete confirm (no window.confirm): the armed row's id, or null
  // when nothing is armed. Reset whenever the menu closes or a DIFFERENT row
  // is hovered/clicked, so a stray click can never land the wrong delete.
  const [armedId, setArmedId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useDialogEscape(open, () => setOpen(false))

  useEffect(() => {
    if (!open) {
      setArmedId(null)
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const active = conversations.find((conversation) => conversation.id === activeConversationId)
  const backgroundRunningCount = conversations.filter(
    (conversation) => conversation.isRunning && conversation.id !== activeConversationId
  ).length

  const handleSelect = (id: string): void => {
    if (id !== activeConversationId) {
      void selectConversation(id)
    }
    setOpen(false)
  }

  const handleNew = (): void => {
    void startNewConversation()
    setOpen(false)
  }

  const handleDeleteClick = (id: string): void => {
    if (armedId === id) {
      void deleteConversation(id)
      setArmedId(null)
      return
    }
    setArmedId(id)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        // Stable accessible name: without it the trigger would be announced by
        // its visible text — the ever-changing active conversation title.
        aria-label="Switch conversation"
        title="Switch conversation"
        onClick={() => setOpen((value) => !value)}
        className={triggerClassName}
      >
        <span className="max-w-24 truncate">{active?.title ?? 'Conversation'}</span>
        {backgroundRunningCount > 0 ? (
          <span
            aria-label={`${backgroundRunningCount} other conversation${backgroundRunningCount === 1 ? '' : 's'} running`}
            className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-none text-white"
          >
            {backgroundRunningCount}
          </span>
        ) : null}
        <FaChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Conversations"
          className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] text-left shadow-lg"
        >
          <ul className="max-h-72 overflow-y-auto py-1">
            {conversations.map((conversation) => {
              const armed = armedId === conversation.id
              return (
                <li
                  key={conversation.id}
                  className="flex items-center gap-1 px-1"
                  onMouseEnter={() =>
                    setArmedId((current) => (current === conversation.id ? current : null))
                  }
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={conversation.id === activeConversationId}
                    onClick={() => handleSelect(conversation.id)}
                    className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--panel-hover)]"
                  >
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${conversation.isRunning ? 'bg-amber-500' : 'bg-transparent'}`}
                    />
                    <span className="flex-1 truncate">{conversation.title}</span>
                    {conversation.id === activeConversationId ? (
                      <span aria-hidden="true" className="shrink-0 text-xs text-[var(--muted)]">
                        ✓
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete conversation ${conversation.title}`}
                    title={armed ? 'Click again to delete' : 'Delete conversation'}
                    onClick={() => handleDeleteClick(conversation.id)}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ${
                      armed
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'text-[var(--muted)] hover:bg-rose-50 hover:text-rose-700'
                    }`}
                  >
                    <FaXmark className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="border-t border-[var(--border)] px-1 py-1">
            <button
              type="button"
              onClick={handleNew}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--panel-hover)]"
            >
              <FaPlus className="h-3 w-3 shrink-0" aria-hidden="true" />
              New conversation
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
