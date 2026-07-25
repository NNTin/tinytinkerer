import type { ChatEvent, InspectorEntry } from '@tinytinkerer/app-browser'
import { describe, expect, it } from 'vitest'
import { deriveRunOutcome, requestsForRun, splitEventsIntoRuns } from '../trace'

let idCounter = 0
const event = <T extends ChatEvent>(partial: Omit<T, 'id' | 'timestamp'>, isoTime: string): T =>
  ({ id: `evt-${(idCounter += 1)}`, timestamp: isoTime, ...partial }) as T

const userMessage = (text: string, isoTime = '2026-01-01T00:00:00.000Z'): ChatEvent =>
  event({ type: 'user.message', payload: { text } }, isoTime)

const runStarted = (isoTime = '2026-01-01T00:00:01.000Z'): ChatEvent =>
  event({ type: 'agent.run.started', payload: { agentType: 'react' } }, isoTime)

const runCompleted = (isoTime = '2026-01-01T00:00:02.000Z'): ChatEvent =>
  event({ type: 'agent.run.completed', payload: { steps: 1 } }, isoTime)

describe('splitEventsIntoRuns', () => {
  it('starts a new run at every user.message', () => {
    const events = [userMessage('first'), runStarted(), runCompleted(), userMessage('second')]
    const runs = splitEventsIntoRuns(events)
    expect(runs).toHaveLength(2)
    expect(runs[0]).toHaveLength(3)
    expect(runs[1]).toHaveLength(1)
  })

  it('returns one run for a single-turn conversation', () => {
    const events = [userMessage('hello'), runStarted(), runCompleted()]
    expect(splitEventsIntoRuns(events)).toEqual([events])
  })

  it('groups a leading non-user.message event into its own run instead of dropping it', () => {
    const notice = event<ChatEvent>(
      { type: 'system', payload: { message: 'restored', level: 'info' } },
      '2026-01-01T00:00:00.000Z'
    )
    const runs = splitEventsIntoRuns([notice])
    expect(runs).toEqual([[notice]])
  })

  it('returns no runs for an empty conversation', () => {
    expect(splitEventsIntoRuns([])).toEqual([])
  })
})

describe('deriveRunOutcome', () => {
  it('reports succeeded for a completed run with no failures', () => {
    const events = [userMessage('hi'), runStarted(), runCompleted()]
    expect(deriveRunOutcome(events, false)).toBe('succeeded')
  })

  it('reports permission-denied when a tool call was blocked, even if the run went on to complete', () => {
    const events = [
      userMessage('hi'),
      runStarted(),
      event<ChatEvent>(
        {
          type: 'agent.tool.failed',
          payload: { stepId: 'step-1', toolId: 'fs.write', error: 'denied', kind: 'blocked' }
        },
        '2026-01-01T00:00:01.500Z'
      ),
      runCompleted()
    ]
    expect(deriveRunOutcome(events, false)).toBe('permission-denied')
  })

  it('reports tool-failure for a non-blocked tool failure', () => {
    const events = [
      userMessage('hi'),
      runStarted(),
      event<ChatEvent>(
        {
          type: 'agent.tool.failed',
          payload: { stepId: 'step-1', toolId: 'fs.read', error: 'boom', kind: 'execution' }
        },
        '2026-01-01T00:00:01.500Z'
      ),
      runCompleted()
    ]
    expect(deriveRunOutcome(events, false)).toBe('tool-failure')
  })

  it('reports tool-failure for a failed step even without a matching tool event', () => {
    const events = [
      userMessage('hi'),
      runStarted(),
      event<ChatEvent>(
        { type: 'agent.step.failed', payload: { stepId: 'step-1', error: 'boom' } },
        '2026-01-01T00:00:01.500Z'
      )
    ]
    expect(deriveRunOutcome(events, false)).toBe('tool-failure')
  })

  it('reports rate-limited for a run that never completed after a rate-limit wait', () => {
    const events = [
      userMessage('hi'),
      runStarted(),
      event<ChatEvent>(
        {
          type: 'rate.limit.waiting',
          payload: {
            retryAfterMs: 1000,
            retryAt: '2026-01-01T00:00:05.000Z',
            message: 'slow down',
            autoRetry: false
          }
        },
        '2026-01-01T00:00:01.500Z'
      )
    ]
    expect(deriveRunOutcome(events, false)).toBe('rate-limited')
  })

  it('reports error for a run that ended with an error event', () => {
    const events = [
      userMessage('hi'),
      runStarted(),
      event<ChatEvent>(
        { type: 'error', payload: { message: 'network down' } },
        '2026-01-01T00:00:01.500Z'
      )
    ]
    expect(deriveRunOutcome(events, false)).toBe('error')
  })

  it('reports cancelled for an incomplete run the caller marked as stopped', () => {
    const events = [userMessage('hi'), runStarted()]
    expect(deriveRunOutcome(events, true)).toBe('cancelled')
  })

  it('falls back to error for an incomplete, non-cancelled run with no other signal', () => {
    const events = [userMessage('hi'), runStarted()]
    expect(deriveRunOutcome(events, false)).toBe('error')
  })
})

describe('requestsForRun', () => {
  const makeEntry = (capturedAt: string, model = 'gpt-test'): InspectorEntry => ({
    request: { model, stream: true, messages: [], capturedAt },
    response: { status: 'pending' }
  })

  it('includes only entries captured within [start, end)', () => {
    const entries = [
      makeEntry('2026-01-01T00:00:00.500Z'),
      makeEntry('2026-01-01T00:00:01.500Z'),
      makeEntry('2026-01-01T00:00:02.500Z')
    ]
    const result = requestsForRun(entries, '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:02.000Z')
    expect(result).toEqual([entries[1]])
  })

  it('includes every entry from start onward for the open-ended live run', () => {
    const entries = [makeEntry('2026-01-01T00:00:01.500Z'), makeEntry('2026-01-01T00:00:02.500Z')]
    const result = requestsForRun(entries, '2026-01-01T00:00:01.000Z', null)
    expect(result).toEqual(entries)
  })

  it('excludes an entry captured before the run started', () => {
    const entries = [makeEntry('2026-01-01T00:00:00.100Z')]
    expect(requestsForRun(entries, '2026-01-01T00:00:01.000Z', null)).toEqual([])
  })
})
