import type { AgentHookContribution } from '@tinytinkerer/app-core'
import { boundedPreview, type ChatEvent } from '@tinytinkerer/contracts'
import { captureTelemetryException, fingerprintMessage } from '../telemetry/telemetry'

// A tool failure never surfaces as a thrown error to the caller of `run()` — the
// runtime folds it into a `{ ok: false }` observation the model reads and moves
// on from (see AgentRuntimeBase.executeToolStep). That is correct for the chat
// loop, but it means a genuine tool bug (a Zod validation error inside a verb,
// a plugin throwing, an unhandled edge case) is otherwise invisible outside the
// transcript. This observer is the ONE path such failures take to Sentry: it
// watches every `agent.tool.failed` event and reports the non-`blocked` ones.
// `blocked` outcomes (policy-disabled tool calls, a `tool.beforeExecute` gate
// denial — see the `kind` taxonomy on `agentToolFailedEventSchema`) are user/
// policy decisions, not bugs, and are deliberately never captured.

// Bound on the failing tool's input included in the capture (see
// `contexts.tool.input` below). Mirrors the request-telemetry convention of
// bounding untrusted payload text so one pathological tool call cannot blow up
// the event size Sentry accepts.
const INPUT_PREVIEW_MAX_CHARS = 2048

// Hard cap on in-flight tool inputs tracked at once. A `started` event with no
// matching `completed`/`failed` (a bug elsewhere, or a run that never finishes)
// would otherwise grow this map forever for the lifetime of the tab. Map
// iteration order is insertion order, so evicting the first key is evicting the
// oldest entry — a cheap approximation of "least likely to still be relevant"
// without tracking timestamps.
const MAX_TRACKED_INPUTS = 50

export const createToolFailureTelemetryHook = (): AgentHookContribution => {
  const inputByStepId = new Map<string, unknown>()

  const remember = (stepId: string, input: unknown): void => {
    if (inputByStepId.size >= MAX_TRACKED_INPUTS) {
      const oldestKey = inputByStepId.keys().next().value
      if (oldestKey !== undefined) {
        inputByStepId.delete(oldestKey)
      }
    }
    inputByStepId.set(stepId, input)
  }

  const handler = ({ event }: { event: ChatEvent }): void => {
    if (event.type === 'agent.tool.started') {
      remember(event.payload.stepId, event.payload.input)
      return
    }
    if (event.type === 'agent.tool.completed') {
      inputByStepId.delete(event.payload.stepId)
      return
    }
    if (event.type !== 'agent.tool.failed') {
      return
    }

    const { stepId, toolId, error, kind } = event.payload
    const input = inputByStepId.get(stepId)
    inputByStepId.delete(stepId)

    if (kind === 'blocked') {
      // Permission denial / policy-disabled — a user or policy decision, not a
      // bug. Nothing to report.
      return
    }

    // `kind` is optional for back-compat with events persisted before this
    // taxonomy existed (see the schema comment). Such an event predates
    // `blocked`/`timeout` altogether, so treat it the same as a thrown error.
    const timedOut = kind === 'timeout'

    captureTelemetryException(new Error(`tool "${toolId}" failed: ${error}`), {
      level: timedOut ? 'warning' : 'error',
      tags: { source: 'tool', tool: toolId, ...(timedOut ? { reason: 'timeout' } : {}) },
      // Every capture here shares the same synthetic stack frame (the `new
      // Error` above), so without an explicit fingerprint Sentry would
      // conflate unrelated tools/failures into a single issue — same
      // rationale as the request-telemetry fingerprint.
      fingerprint: ['tool-failure', toolId, fingerprintMessage(error)],
      // The failing input is what makes a tool bug diagnosable (e.g. which
      // malformed field tripped a Zod validation error). Included only when
      // the `started` event was actually observed; consent gating and
      // `beforeSend` scrubbing still apply downstream (see
      // docs/sentry-telemetry.md), so this is not a raw, unbounded dump.
      ...(input !== undefined
        ? { contexts: { tool: { stepId, input: boundedPreview(input, INPUT_PREVIEW_MAX_CHARS) } } }
        : {})
    })
  }

  return { event: 'chat.event', handler }
}
