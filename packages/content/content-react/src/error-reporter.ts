// Shared sink for content render failures. Lives in its own module so both the
// React RendererBoundary (index.tsx) and the generic content runtime
// (runtime.ts) can report through it without a circular import. Injected by the
// host (the browser wires it to Sentry telemetry); a host that registers nothing
// — SSR, tests, opted-out hosts — simply drops the report and rendering still
// falls back gracefully. This keeps the package a leaf with no telemetry
// dependency, mirroring the sentry-telemetry capture-sink injection.

// Structured context attached to a reported render failure. All fields are
// optional so each report site supplies only what it knows: the boundary has a
// React `componentStack`; the runtime catch has the `nodeType` / `pluginId` and
// a `reason`.
export type ContentRenderErrorInfo = {
  componentStack?: string
  nodeType?: string
  pluginId?: string
  reason?: string
}

export type ContentRenderErrorReporter = (
  error: Error,
  info: ContentRenderErrorInfo
) => void

let renderErrorReporter: ContentRenderErrorReporter | null = null

/**
 * Registers (or clears, with `null`) the reporter invoked when a content node
 * fails to render — whether the failure is caught by the React RendererBoundary
 * or by the runtime's per-node try/catch. Without it, failures still fall back
 * silently. Called once by the host after bootstrap.
 */
export const setContentRenderErrorReporter = (
  reporter: ContentRenderErrorReporter | null
): void => {
  renderErrorReporter = reporter
}

/**
 * Normalizes and dispatches a render failure to the registered reporter. No-ops
 * when none is registered. Guarded so a misbehaving sink can never turn a
 * recovered render error into a crash.
 */
export const reportContentRenderError = (
  error: unknown,
  info: ContentRenderErrorInfo = {}
): void => {
  if (!renderErrorReporter) {
    return
  }
  const normalized =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'Content render error')
  try {
    renderErrorReporter(normalized, info)
  } catch {
    // Telemetry must never break rendering.
  }
}
