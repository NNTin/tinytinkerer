import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  captureTelemetryException,
  captureTelemetryMessage,
  setCaptureExceptionSink,
  setCaptureMessageSink,
  type CaptureExceptionSink,
  type CaptureMessageSink
} from '../src/capture.js'

const exceptionSink = vi.fn<CaptureExceptionSink>()
const messageSink = vi.fn<CaptureMessageSink>()

afterEach(() => {
  setCaptureExceptionSink(null)
  setCaptureMessageSink(null)
  exceptionSink.mockReset()
  messageSink.mockReset()
})

describe('captureTelemetryMessage', () => {
  it('dispatches the message and options to the registered message sink', () => {
    setCaptureMessageSink(messageSink)

    captureTelemetryMessage('Feedback (idea): add dark mode', {
      level: 'info',
      tags: { plugin: 'send-feedback' }
    })

    expect(messageSink).toHaveBeenCalledTimes(1)
    expect(messageSink).toHaveBeenCalledWith('Feedback (idea): add dark mode', {
      level: 'info',
      tags: { plugin: 'send-feedback' }
    })
  })

  it('no-ops when no message sink is registered', () => {
    expect(() => captureTelemetryMessage('orphaned message')).not.toThrow()
  })

  it('does not route a message through the exception sink', () => {
    setCaptureExceptionSink(exceptionSink)
    setCaptureMessageSink(messageSink)

    captureTelemetryMessage('an info message', { level: 'info' })

    expect(messageSink).toHaveBeenCalledTimes(1)
    expect(exceptionSink).not.toHaveBeenCalled()
  })

  it('keeps the exception sink independent of the message sink', () => {
    setCaptureExceptionSink(exceptionSink)
    setCaptureMessageSink(messageSink)

    captureTelemetryException(new Error('boom'), { level: 'error' })

    expect(exceptionSink).toHaveBeenCalledTimes(1)
    expect(messageSink).not.toHaveBeenCalled()
  })
})
