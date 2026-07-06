// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from '../src/app-error-boundary.js'
import { captureTelemetryException } from '../src/telemetry/telemetry.js'

vi.mock('../src/telemetry/telemetry.js', () => ({
  captureTelemetryException: vi.fn(),
  fingerprintMessage: (message: string) => message
}))

// A component that throws during React's render phase, escaping into the
// renderer where only an error boundary can catch it.
const ThrowDuringRender = (): never => {
  throw new Error('boom')
}

// React logs caught render errors to console.error; silence it so the test
// output stays clean.
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('AppErrorBoundary', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the recovery fallback instead of unmounting when a child throws', () => {
    const consoleError = silenceConsoleError()
    try {
      render(
        <AppErrorBoundary>
          <div>
            <p>healthy content</p>
            <ThrowDuringRender />
          </div>
        </AppErrorBoundary>
      )
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
      expect(screen.getByText('boom')).toBeInTheDocument()
      expect(screen.queryByText('healthy content')).not.toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('re-renders the children when "Try again" is clicked', () => {
    let shouldThrow = true
    const Flaky = () => {
      if (shouldThrow) {
        throw new Error('flaky')
      }
      return <p>recovered content</p>
    }
    const consoleError = silenceConsoleError()
    try {
      render(
        <AppErrorBoundary>
          <Flaky />
        </AppErrorBoundary>
      )
      expect(screen.getByRole('alert')).toBeInTheDocument()

      shouldThrow = false
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

      expect(screen.getByText('recovered content')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('forwards the error to telemetry tagged with the surface label', () => {
    const consoleError = silenceConsoleError()
    try {
      render(
        <AppErrorBoundary label="root-pane-web">
          <ThrowDuringRender />
        </AppErrorBoundary>
      )
      const capture = vi.mocked(captureTelemetryException)
      expect(capture).toHaveBeenCalledTimes(1)
      const [error, options] = capture.mock.calls[0]!
      expect(error).toBeInstanceOf(Error)
      // captureTelemetryException's first param is typed `unknown`; the assertion
      // above proves it is an Error at runtime.
      expect((error as Error).message).toBe('boom')
      expect(options?.tags).toEqual({ source: 'app-shell', app_shell_surface: 'root-pane-web' })
      expect(options?.fingerprint).toEqual(['app-shell', 'root-pane-web', 'boom'])
      expect(options?.contexts?.react?.componentStack).toEqual(expect.any(String))
    } finally {
      consoleError.mockRestore()
    }
  })

  it('omits the surface tag and falls back to "app" in the fingerprint without a label', () => {
    const consoleError = silenceConsoleError()
    try {
      render(
        <AppErrorBoundary>
          <ThrowDuringRender />
        </AppErrorBoundary>
      )
      const capture = vi.mocked(captureTelemetryException)
      expect(capture).toHaveBeenCalledTimes(1)
      const [, options] = capture.mock.calls[0]!
      expect(options?.tags).toEqual({ source: 'app-shell' })
      expect(options?.fingerprint).toEqual(['app-shell', 'app', 'boom'])
    } finally {
      consoleError.mockRestore()
    }
  })
})
