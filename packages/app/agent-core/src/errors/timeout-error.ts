// A terminal runtime timeout: a single-shot model call (the planner, a
// non-streaming ReAct decision, an execution step) or a streaming decision's
// first/idle wait did not produce output within its budget. Modelled as its own
// error type for two reasons:
//
//   * The host's telemetry sink classifies it as a *warning* rather than a hard
//     error. A slow or briefly unavailable upstream (e.g. a reasoning model like
//     `openai/gpt-5` via LiteLLM that is slow to first token) is a degraded
//     condition, not a crash — the run still ends with a friendly fallback — so
//     it should not page like an unexpected exception, but it must still be
//     visible to spot a misbehaving model/route (TINYTINKERER-FRONTEND-S).
//   * It is NOT an AbortError, so the terminal handler still reports it. An
//     AbortError is the user cancelling and is deliberately never reported.
export class RuntimeTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeTimeoutError'
  }
}

// Cross-realm/bundle safe: also matches by name so a RuntimeTimeoutError thrown
// in agent-core and inspected after crossing the app-core adapter boundary is
// still recognised even if the class identity differs.
export const isRuntimeTimeoutError = (error: unknown): error is RuntimeTimeoutError =>
  error instanceof RuntimeTimeoutError ||
  (error instanceof Error && error.name === 'RuntimeTimeoutError')
