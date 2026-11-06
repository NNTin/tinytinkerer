import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConversationSwitcher, type ConversationSwitcherItem } from '../ConversationSwitcher'

const conversations: ConversationSwitcherItem[] = [
  { id: 'conv-a', title: 'First conversation', status: 'awaiting-input' },
  { id: 'conv-b', title: 'Second conversation', status: 'running-tool' }
]

describe('ConversationSwitcher', () => {
  it('lists every conversation with its status and marks the active one', () => {
    render(
      <ConversationSwitcher
        conversations={conversations}
        activeConversationId="conv-b"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('First conversation')).toBeInTheDocument()
    expect(screen.getByText('Second conversation')).toBeInTheDocument()
    expect(screen.getByText('Awaiting input')).toBeInTheDocument()
    expect(screen.getByText('Using a tool…')).toBeInTheDocument()

    const activeButton = screen.getByRole('button', { name: /^Second conversation/ })
    expect(activeButton).toHaveAttribute('aria-current', 'true')
    const inactiveButton = screen.getByRole('button', { name: /^First conversation/ })
    expect(inactiveButton).not.toHaveAttribute('aria-current')
  })

  it('selects a conversation by clicking its native button', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ConversationSwitcher
        conversations={conversations}
        activeConversationId="conv-b"
        onSelect={onSelect}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /^First conversation/ }))
    expect(onSelect).toHaveBeenCalledWith('conv-a')
  })

  it('starts a new conversation via the create button', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(
      <ConversationSwitcher
        conversations={conversations}
        activeConversationId={undefined}
        onSelect={vi.fn()}
        onCreate={onCreate}
        onDelete={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('requires a second confirming click before deleting (arm-then-confirm, no window.confirm)', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(
      <ConversationSwitcher
        conversations={conversations}
        activeConversationId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={onDelete}
      />
    )

    const deleteButton = screen.getByRole('button', {
      name: 'Delete conversation "First conversation"'
    })
    await user.click(deleteButton)
    expect(onDelete).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Confirm deleting conversation "First conversation"' })
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Confirm deleting conversation "First conversation"' })
    )
    expect(onDelete).toHaveBeenCalledWith('conv-a')
  })

  it('disarms a pending delete when a different conversation is selected', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(
      <ConversationSwitcher
        conversations={conversations}
        activeConversationId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={onDelete}
      />
    )

    await user.click(
      screen.getByRole('button', { name: 'Delete conversation "First conversation"' })
    )
    await user.click(screen.getByRole('button', { name: /^Second conversation/ }))

    expect(
      screen.getByRole('button', { name: 'Delete conversation "First conversation"' })
    ).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })
})
