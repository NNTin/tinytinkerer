import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { AgentHookContribution } from '@tinytinkerer/app-core'
import type { ChatEvent } from '@tinytinkerer/contracts'
import type { TelemetryCaptureOptions } from '@tinytinkerer/sentry-telemetry'

type CaptureCall = (error: unknown, options: TelemetryCaptureOptions) => void

const captureTelemetryException = vi.hoisted(() => vi.fn<CaptureCall>())
// Matches the real `fingerprintMessage` closely enough for assertions (trim +
// collapse whitespace); the exact truncation behaviour is covered by
// telemetry.test.ts, so the double only needs to be a recognizable stand-in.
const fingerprintMessage = vi.hoisted(() => vi.fn((message: string) => message.trim()))

vi.mock('../src/telemetry/telemetry', () => ({
  captureTelemetryException,
  fingerprintMessage
}))

import { createToolFailureTelemetryHook } from '../src/runtime/tool-failure-telemetry.js'

const started = (stepId: string, toolId: string, input: Record<string, unknown>): ChatEvent => ({
  id: `${stepId}-started`,
  timestamp: new Date().toISOString(),
  type: 'agent.tool.started',
  payload: { stepId, toolId, input }
})

const completed = (stepId: string, toolId: string): ChatEvent => ({
  id: `${stepId}-completed`,
  timestamp: new Date().toISOString(),
  type: 'agent.tool.completed',
  payload: { stepId, toolId, output: 'ok' }
})

const failed = (
  stepId: string,
  toolId: string,
  error: string,
  kind?: 'blocked' | 'timeout' | 'execution'
): ChatEvent => ({
  id: `${stepId}-failed`,
  timestamp: new Date().toISOString(),
  type: 'agent.tool.failed',
  payload: { stepId, toolId, error, ...(kind ? { kind } : {}) }
})

describe('createToolFailureTelemetryHook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const dispatch = async (hook: AgentHookContribution, event: ChatEvent): Promise<void> => {
    if (hook.event !== 'chat.event') {
      throw new Error('expected an observer hook')
    }
    await hook.handler({ event })
  }

  it('captures an execution failure at error level with tool tag, fingerprint, and bounded input', async () => {
    const hook = createToolFailureTelemetryHook()
    await dispatch(hook, started('step-1', 'preview', { sceneId: 'abc' }))
    await dispatch(hook, failed('step-1', 'preview', 'Zod validation failed', 'execution'))

    expect(captureTelemetryException).toHaveBeenCalledTimes(1)
    const [error, options] = captureTelemetryException.mock.calls[0] ?? []
    expect((error as Error).message).toBe('tool "preview" failed: Zod validation failed')
    expect(options).toMatchObject({
      level: 'error',
      tags: { source: 'tool', tool: 'preview' },
      fingerprint: ['tool-failure', 'preview', 'Zod validation failed']
    })
    expect(options?.contexts?.tool?.input).toContain('sceneId')
  })

  it('captures a timeout failure at warning level with a reason tag', async () => {
    const hook = createToolFailureTelemetryHook()
    await dispatch(hook, started('step-1', 'preview', {}))
    await dispatch(hook, failed('step-1', 'preview', 'Tool preview timed out', 'timeout'))

    expect(captureTelemetryException).toHaveBeenCalledTimes(1)
    const [, options] = captureTelemetryException.mock.calls[0] ?? []
    expect(options).toMatchObject({
      level: 'warning',
      tags: { source: 'tool', tool: 'preview', reason: 'timeout' }
    })
  })

  it('does not capture a blocked failure', async () => {
    const hook = createToolFailureTelemetryHook()
    await dispatch(hook, started('step-1', 'preview', {}))
    await dispatch(hook, failed('step-1', 'preview', 'Tool execution blocked: denied', 'blocked'))

    expect(captureTelemetryException).not.toHaveBeenCalled()
  })

  it('treats a legacy failed event with kind omitted as an execution-level capture', async () => {
    const hook = createToolFailureTelemetryHook()
    await dispatch(hook, started('step-1', 'preview', {}))
    await dispatch(hook, failed('step-1', 'preview', 'boom'))

    expect(captureTelemetryException).toHaveBeenCalledTimes(1)
    const [, options] = captureTelemetryException.mock.calls[0] ?? []
    expect(options?.level).toBe('error')
  })

  it('drops the stored input once a completed event arrives, so a later failed event carries none', async () => {
    const hook = createToolFailureTelemetryHook()
    await dispatch(hook, started('step-1', 'preview', { foo: 'bar' }))
    await dispatch(hook, completed('step-1', 'preview'))
    await dispatch(hook, failed('step-1', 'preview', 'boom', 'execution'))

    expect(captureTelemetryException).toHaveBeenCalledTimes(1)
    const [, options] = captureTelemetryException.mock.calls[0] ?? []
    expect(options?.contexts).toBeUndefined()
  })

  it('bounds an oversized input and marks it truncated', async () => {
    const hook = createToolFailureTelemetryHook()
    const bigValue = 'x'.repeat(3000)
    await dispatch(hook, started('step-1', 'preview', { bigValue }))
    await dispatch(hook, failed('step-1', 'preview', 'boom', 'execution'))

    const [, options] = captureTelemetryException.mock.calls[0] ?? []
    const input = options?.contexts?.tool?.input
    expect(typeof input).toBe('string')
    expect((input as string).length).toBeLessThan(3000)
    expect((input as string).endsWith('…')).toBe(true)
  })

  it('caps tracked inputs so an unbounded run does not leak memory', async () => {
    const hook = createToolFailureTelemetryHook()
    for (let i = 0; i < 60; i += 1) {
      await dispatch(hook, started(`step-${i}`, 'preview', { i }))
    }
    // The newest entry must still be tracked (it fits well within the cap of 50
    // counted from the tail of 60 inserts).
    await dispatch(hook, failed('step-59', 'preview', 'boom', 'execution'))

    expect(captureTelemetryException).toHaveBeenCalledTimes(1)
    const [, options] = captureTelemetryException.mock.calls[0] ?? []
    expect(options?.contexts?.tool?.input).toContain('59')
  })
})
