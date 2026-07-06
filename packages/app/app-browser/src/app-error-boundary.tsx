import { Component, type ErrorInfo, type ReactNode } from 'react'
import { surfaceButtonClass } from './chat-shell/surface-button'
import { captureTelemetryException, fingerprintMessage } from './telemetry/telemetry'

export type AppErrorBoundaryProps = {
  children: ReactNode
  // Names the crashed surface for telemetry tags (e.g. 'root-pane-web').
  label?: string
}

type AppErrorBoundaryState = { hasError: boolean; message?: string }

// App-level error boundary (issue #352). Without it a render throw anywhere in
// the shell (TurnChrome, layouts, settings, prompt host, telemetry gates)
// unmounts the whole React root and leaves a white screen. Catches the throw,
// reports it to Sentry, and offers an in-place retry — session state lives in
// the stores above this boundary, so re-rendering the children recovers the
// conversation when the fault was transient.
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, message: error.message }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Same rationale as content-react's RendererBoundary: once the fallback
    // swaps in, the error is otherwise swallowed. The capture function no-ops
    // until telemetry is initialized, so no guarding is needed here.
    const { label } = this.props
    captureTelemetryException(error, {
      level: 'error',
      tags: {
        source: 'app-shell',
        ...(label ? { app_shell_surface: label } : {})
      },
      ...(info.componentStack
        ? { contexts: { react: { componentStack: info.componentStack } } }
        : {}),
      fingerprint: ['app-shell', label ?? 'app', fingerprintMessage(error.message)]
    })
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="flex h-full w-full items-center justify-center p-4">
          <div className="max-w-md rounded-xl border border-[var(--widget-border)] bg-[var(--panel)] px-4 py-4 text-[var(--text)]">
            <h2 className="text-sm font-semibold">Something went wrong</h2>
            <p className="mt-1 text-[13px] leading-5 text-[var(--muted)]">
              This part of the app hit an unexpected error. Your conversation is preserved.
            </p>
            {this.state.message ? (
              <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{this.state.message}</p>
            ) : null}
            <div className="mt-3 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false })}
                className={surfaceButtonClass('default', 'h-8 px-3')}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className={surfaceButtonClass('secondary', 'h-8 px-3')}
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
