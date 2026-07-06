// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Turn } from '@tinytinkerer/app-core'

// Count how often each turn's assistant content actually renders, so we can
// prove the memoized TurnChrome skips settled turns on a streamed delta (#340).
const { renderCounts } = vi.hoisted(() => ({ renderCounts: new Map<string, number>() }))

vi.mock('../src/assistant-content', () => ({
  AssistantContent: ({ turnId }: { turnId?: string }) => {
    const key = turnId ?? '?'
    renderCounts.set(key, (renderCounts.get(key) ?? 0) + 1)
    return null
  }
}))

const { TurnChrome } = await import('../src/turn-chrome.js')

const noServers = new Map<string, string>()

const makeTurn = (id: string, source: string, overrides: Partial<Turn> = {}): Turn => ({
  id,
  userText: '',
  assistantSource: source,
  assistantContent: { nodes: [{ type: 'paragraph', id: `p-${id}`, children: [] }] },
  isStreaming: false,
  activity: { items: [], reasoningText: '' },
  ...overrides
})

// A conversation list mirroring how the surfaces render turns: the last turn is
// live, earlier turns are settled.
const TurnList = ({ turns }: { turns: Turn[] }) => (
  <>
    {turns.map((turn, index) => (
      <TurnChrome
        key={turn.id}
        turn={turn}
        isLive={index === turns.length - 1}
        serverNameById={noServers}
      />
    ))}
  </>
)

describe('TurnChrome memoization (issue #340)', () => {
  beforeEach(() => renderCounts.clear())
  afterEach(cleanup)

  it('does not re-render a settled turn when a later turn streams', () => {
    const settled = makeTurn('settled', 'a settled answer')
    const streamingA = makeTurn('live', 'par', { isStreaming: true })

    const { rerender } = render(<TurnList turns={[settled, streamingA]} />)
    expect(renderCounts.get('settled')).toBe(1)
    expect(renderCounts.get('live')).toBe(1)

    // A streamed delta: the settled turn keeps its identity (as reconcileTurns
    // guarantees), only the live turn is a new object.
    const streamingB = makeTurn('live', 'partial answer', { isStreaming: true })
    rerender(<TurnList turns={[settled, streamingB]} />)

    // The settled turn was skipped by React.memo; the live turn re-rendered.
    expect(renderCounts.get('settled')).toBe(1)
    expect(renderCounts.get('live')).toBe(2)
  })

  it('re-renders a turn whose identity changed', () => {
    const settled = makeTurn('settled', 'first')
    const { rerender } = render(<TurnList turns={[settled, makeTurn('live', 'x')]} />)
    expect(renderCounts.get('settled')).toBe(1)

    // A genuinely different settled turn object (e.g. content edited) must render.
    rerender(<TurnList turns={[makeTurn('settled', 'edited'), makeTurn('live', 'x')]} />)
    expect(renderCounts.get('settled')).toBe(2)
  })
})
