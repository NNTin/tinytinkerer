// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Turn } from '@tinytinkerer/app-core'
import { TurnChrome, deriveTurnStatus } from '../src/turn-chrome.js'

const makeTurn = (overrides: Partial<Turn> = {}): Turn => ({
  id: 'turn-1',
  userText: 'hi',
  assistantSource: 'Hello **world**',
  assistantContent: {
    nodes: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hello world' }] }]
  },
  isStreaming: false,
  activity: { items: [], reasoningText: '' },
  ...overrides
})

const noServers = new Map<string, string>()

describe('deriveTurnStatus (C2)', () => {
  it('reports the most recent in-flight tool', () => {
    const turn = makeTurn({
      activity: {
        reasoningText: '',
        items: [
          { kind: 'tool', id: 't1', toolId: 'web-search', status: 'completed' },
          { kind: 'tool', id: 't2', toolId: 'read_dom', status: 'started' }
        ]
      }
    })
    expect(deriveTurnStatus(turn, noServers)).toBe('Running read_dom…')
  })

  it('falls back to the latest reasoning/plan label', () => {
    const turn = makeTurn({
      assistantContent: null,
      activity: {
        reasoningText: '',
        items: [{ kind: 'label', id: 'l1', label: 'Planning the approach' }]
      }
    })
    expect(deriveTurnStatus(turn, noServers)).toBe('Planning the approach')
  })

  it('says generating when content has started but no activity is pending', () => {
    expect(deriveTurnStatus(makeTurn(), noServers)).toBe('Generating response…')
  })

  it('says thinking when there is neither content nor activity', () => {
    expect(deriveTurnStatus(makeTurn({ assistantContent: null }), noServers)).toBe('Thinking…')
  })
})

describe('TurnChrome', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders nothing for an empty, non-live turn', () => {
    const { container } = render(
      <TurnChrome
        turn={makeTurn({ assistantContent: null })}
        isLive={false}
        serverNameById={noServers}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('copies the assistant source to the clipboard', async () => {
    render(<TurnChrome turn={makeTurn()} isLive={false} serverNameById={noServers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    expect(writeText).toHaveBeenCalledWith('Hello **world**')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copied message' })).toBeInTheDocument()
    )
  })

  it('collapses and expands the message via an accessible toggle', () => {
    render(<TurnChrome turn={makeTurn()} isLive={false} serverNameById={noServers} />)
    const toggle = screen.getByRole('button', { name: /collapse message/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: /show full message/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('exposes regenerate only when the capability is provided', () => {
    const onRegenerateLatest = vi.fn()
    const { rerender } = render(
      <TurnChrome turn={makeTurn()} isLive={false} serverNameById={noServers} />
    )
    expect(screen.queryByRole('button', { name: 'Regenerate response' })).toBeNull()

    rerender(
      <TurnChrome
        turn={makeTurn()}
        isLive={false}
        serverNameById={noServers}
        onRegenerateLatest={onRegenerateLatest}
        canRegenerateLatest
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }))
    expect(onRegenerateLatest).toHaveBeenCalledTimes(1)
  })

  it('hides actions while the turn is still streaming', () => {
    render(
      <TurnChrome
        turn={makeTurn({ isStreaming: true })}
        isLive
        serverNameById={noServers}
        onRegenerateLatest={() => undefined}
        canRegenerateLatest
      />
    )
    expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull()
  })

  it('shows the live status line for a streaming turn with no content yet', () => {
    render(
      <TurnChrome turn={makeTurn({ assistantContent: null })} isLive serverNameById={noServers} />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Thinking…')
  })
})
