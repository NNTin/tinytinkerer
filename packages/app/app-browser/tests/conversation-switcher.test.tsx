// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationSwitcher } from '../src/chat-shell/conversation-switcher.js'

const conversations = [
  { id: 'a', title: 'Active conversation', isRunning: false },
  { id: 'b', title: 'Background running', isRunning: true },
  { id: 'c', title: 'Idle in background', isRunning: false }
]

afterEach(() => {
  cleanup()
})

const renderSwitcher = (overrides: Partial<Parameters<typeof ConversationSwitcher>[0]> = {}) => {
  const selectConversation = vi.fn(() => Promise.resolve())
  const startNewConversation = vi.fn(() => Promise.resolve())
  const deleteConversation = vi.fn(() => Promise.resolve())
  const utils = render(
    <ConversationSwitcher
      conversations={conversations}
      activeConversationId="a"
      selectConversation={selectConversation}
      startNewConversation={startNewConversation}
      deleteConversation={deleteConversation}
      triggerClassName="trigger"
      {...overrides}
    />
  )
  return { ...utils, selectConversation, startNewConversation, deleteConversation }
}

// The menu body is lazy-loaded on first open (bundle-budget split), so tests
// open it and await a menu element before asserting.
const openMenu = async () => {
  fireEvent.click(screen.getByRole('button', { name: /switch conversation/i }))
  await screen.findByRole('listbox')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ConversationSwitcher', () => {
  it('shows the active conversation title on the trigger and a badge for other running conversations', () => {
    renderSwitcher()
    expect(screen.getByRole('button', { name: /switch conversation/i })).toHaveTextContent(
      'Active conversation'
    )
    // One OTHER conversation ('b') is running; the active one is not counted.
    expect(screen.getByLabelText('1 other conversation running')).toBeInTheDocument()
  })

  it('opens the menu and lists one row per conversation, in order', async () => {
    renderSwitcher()
    await openMenu()

    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Active conversation✓',
      'Background running',
      'Idle in background'
    ])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('selects a conversation and closes the menu', async () => {
    const { selectConversation } = renderSwitcher()
    await openMenu()
    fireEvent.click(screen.getByRole('option', { name: /background running/i }))

    expect(selectConversation).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not re-select the already-active conversation', async () => {
    const { selectConversation } = renderSwitcher()
    await openMenu()
    fireEvent.click(screen.getByRole('option', { name: /active conversation/i }))

    expect(selectConversation).not.toHaveBeenCalled()
    // The menu still closes.
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('starts a new conversation from the menu action row', async () => {
    const { startNewConversation } = renderSwitcher()
    await openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))

    expect(startNewConversation).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('requires two clicks to delete a conversation', async () => {
    const { deleteConversation } = renderSwitcher()
    await openMenu()

    const deleteButton = screen.getByRole('button', {
      name: 'Delete conversation Idle in background'
    })
    fireEvent.click(deleteButton)
    expect(deleteConversation).not.toHaveBeenCalled()

    fireEvent.click(deleteButton)
    expect(deleteConversation).toHaveBeenCalledWith('c')
  })

  it('disarms the pending delete confirmation when the menu closes', async () => {
    const { deleteConversation } = renderSwitcher()
    await openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation Idle in background' }))

    // Close via Escape, reopen, then a single click must NOT delete (the armed
    // state was reset when the menu closed).
    fireEvent.keyDown(window, { key: 'Escape' })
    await openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation Idle in background' }))

    expect(deleteConversation).not.toHaveBeenCalled()
  })

  it('disarms the pending delete confirmation when another row is hovered', async () => {
    const { deleteConversation } = renderSwitcher()
    await openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation Idle in background' }))

    // Hovering a DIFFERENT row disarms; the next click on the original row
    // re-arms instead of deleting.
    const rows = screen.getAllByRole('listitem')
    fireEvent.mouseEnter(rows[0] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation Idle in background' }))

    expect(deleteConversation).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    renderSwitcher()
    await openMenu()
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on an outside click', async () => {
    renderSwitcher()
    await openMenu()
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('renders no running badge when nothing else is running', () => {
    renderSwitcher({
      conversations: [
        { id: 'a', title: 'Active conversation', isRunning: false },
        { id: 'b', title: 'Idle', isRunning: false }
      ]
    })
    expect(screen.queryByLabelText(/running$/)).toBeNull()
  })
})
