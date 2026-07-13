// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { useLiveChatActivity } from '../src/live-chat-activity'

const event = (id: string, type: ChatEvent['type']): ChatEvent =>
  ({ id, type, timestamp: '2026-07-13T00:00:00.000Z', payload: {} }) as ChatEvent

type Harness = {
  onRunStarted: ReturnType<typeof vi.fn>
  onRunEnded: ReturnType<typeof vi.fn>
  onLiveEvents: ReturnType<typeof vi.fn>
  rerenderWith: (events: readonly ChatEvent[], isRunning: boolean, enabled: boolean) => void
}

const renderActivity = (
  initialEvents: readonly ChatEvent[],
  initialIsRunning: boolean,
  initialEnabled: boolean
): Harness => {
  const onRunStarted = vi.fn<() => void>()
  const onRunEnded = vi.fn<() => void>()
  const onLiveEvents = vi.fn<(events: readonly ChatEvent[]) => void>()

  const { rerender } = renderHook(
    (props: { events: readonly ChatEvent[]; isRunning: boolean; enabled: boolean }) =>
      useLiveChatActivity(props.events, props.isRunning, {
        // Deliberately fresh closures each render: the hook must not re-fire on
        // their identity churn.
        enabled: props.enabled,
        onRunStarted: () => onRunStarted(),
        onRunEnded: () => onRunEnded(),
        onLiveEvents: (events) => onLiveEvents(events)
      }),
    {
      initialProps: { events: initialEvents, isRunning: initialIsRunning, enabled: initialEnabled }
    }
  )

  return {
    onRunStarted,
    onRunEnded,
    onLiveEvents,
    rerenderWith: (events, isRunning, enabled) => rerender({ events, isRunning, enabled })
  }
}

describe('useLiveChatActivity', () => {
  it('delivers nothing while disabled', () => {
    const events = [event('a', 'agent.run.started')]
    const { onRunStarted, onRunEnded, onLiveEvents, rerenderWith } = renderActivity(
      events,
      true,
      false
    )
    rerenderWith([...events, event('b', 'agent.tool.started')], true, false)
    expect(onLiveEvents).not.toHaveBeenCalled()
    expect(onRunStarted).not.toHaveBeenCalled()
    expect(onRunEnded).not.toHaveBeenCalled()
  })

  it('seeds everything on enabling while idle; later idle events deliver nothing', () => {
    const seenAtEnable = [event('a', 'agent.run.started'), event('b', 'agent.run.completed')]
    const { onRunStarted, onLiveEvents, rerenderWith } = renderActivity(seenAtEnable, false, true)
    expect(onLiveEvents).not.toHaveBeenCalled()

    rerenderWith([...seenAtEnable, event('c', 'user.message')], false, true)
    expect(onLiveEvents).not.toHaveBeenCalled()
    expect(onRunStarted).not.toHaveBeenCalled()
  })

  it('enabling mid-run delivers only the tail after the last agent.run.started', () => {
    const events = [
      event('old-1', 'agent.run.started'),
      event('old-2', 'agent.tool.started'),
      event('old-3', 'agent.run.completed'),
      event('run-start', 'agent.run.started'),
      event('run-tool', 'agent.tool.started')
    ]
    const { onLiveEvents } = renderActivity(events, true, true)
    expect(onLiveEvents).toHaveBeenCalledTimes(1)
    // The seeded boundary (the last agent.run.started) is itself marked seen, so
    // only what comes after it is delivered as catch-up.
    expect(onLiveEvents).toHaveBeenCalledWith([events[4]])
  })

  it('fires onRunStarted before the first onLiveEvents delivery on idle -> running', () => {
    const idleEvents = [event('a', 'agent.run.completed')]
    const { onRunStarted, onLiveEvents, rerenderWith } = renderActivity(idleEvents, false, true)

    const runStartedEvent = event('b', 'agent.run.started')
    const toolEvent = event('c', 'agent.tool.started')
    rerenderWith([...idleEvents, runStartedEvent, toolEvent], true, true)

    expect(onRunStarted).toHaveBeenCalledTimes(1)
    expect(onLiveEvents).toHaveBeenCalledTimes(1)
    const runStartedOrder = onRunStarted.mock.invocationCallOrder[0] ?? -1
    const liveEventsOrder = onLiveEvents.mock.invocationCallOrder[0] ?? -1
    expect(runStartedOrder).toBeLessThan(liveEventsOrder)
    // The new run's own agent.run.started is the reseed boundary (itself marked
    // seen); only what comes after it is delivered.
    expect(onLiveEvents).toHaveBeenCalledWith([toolEvent])
  })

  it('fires onRunEnded on running -> idle and never redelivers those events', () => {
    const runStartedEvent = event('a', 'agent.run.started')
    const toolEvent = event('b', 'agent.tool.started')
    const { onRunEnded, onLiveEvents, rerenderWith } = renderActivity(
      [runStartedEvent, toolEvent],
      true,
      true
    )
    expect(onLiveEvents).toHaveBeenCalledTimes(1)

    const completedEvent = event('c', 'agent.run.completed')
    const finalEvents = [runStartedEvent, toolEvent, completedEvent]
    rerenderWith(finalEvents, false, true)
    expect(onRunEnded).toHaveBeenCalledTimes(1)
    expect(onLiveEvents).toHaveBeenCalledTimes(1)

    // Re-render with a new array wrapping the same (still-idle) events: a new
    // reference re-runs the effect, but nothing is re-delivered.
    rerenderWith([...finalEvents], false, true)
    expect(onRunEnded).toHaveBeenCalledTimes(1)
    expect(onLiveEvents).toHaveBeenCalledTimes(1)
  })

  it('does not deliver duplicates across rerenders with the same array', () => {
    const events = [event('a', 'agent.run.started'), event('b', 'agent.tool.started')]
    const { onLiveEvents, rerenderWith } = renderActivity(events, true, true)
    expect(onLiveEvents).toHaveBeenCalledTimes(1)

    rerenderWith(events, true, true)
    rerenderWith(events, true, true)
    expect(onLiveEvents).toHaveBeenCalledTimes(1)
  })
})
