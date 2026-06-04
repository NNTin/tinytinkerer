import {
  PluginCaptureError,
  type AgentPlugin,
  type Tool
} from '@tinytinkerer/agent-core'
import { feedbackInputSchema, type FeedbackInput } from '@tinytinkerer/contracts'

// Stable id used as the activation key and capture tag. Must match the manifest
// id surfaced in the Settings Modal.
export const SEND_FEEDBACK_PLUGIN_ID = 'send-feedback'

// UI metadata for the Settings Modal "Plugins" section. Co-located with the
// plugin so a new plugin ships its own toggle copy.
export type PluginManifest = {
  id: string
  label: string
  description: string
}

export const feedbackPluginManifest: PluginManifest = {
  id: SEND_FEEDBACK_PLUGIN_ID,
  label: 'Feedback (send_feedback tool)',
  description:
    "Lets the assistant submit your feedback. There's no backend yet, so when telemetry is also enabled your feedback is sent through telemetry. Turning it on adds the send_feedback tool to every chat, which takes up a little of the assistant's context and spends some extra tokens — so the Chat Assistant may perform slightly worse. Leaving it on is a small way to support the project (think of it as buying me a coffee) and saves me development time. Off by default."
}

// Thrown by the send_feedback tool. Carries the feedback as a structured report
// so the agent-core plugin registry routes it to the host capture sink (Sentry
// in the browser), then signals that no backend exists yet via "not implemented".
export class FeedbackPendingError extends PluginCaptureError {
  constructor(input: FeedbackInput) {
    super(
      {
        pluginId: SEND_FEEDBACK_PLUGIN_ID,
        kind: 'feedback',
        level: 'warning',
        message: `User feedback: ${input.message}`,
        contexts: {
          feedback: {
            category: input.category ?? 'general',
            message: input.message
          }
        }
      },
      'send_feedback: not implemented (no backend)'
    )
    this.name = 'FeedbackPendingError'
  }
}

const createSendFeedbackTool = (): Tool<FeedbackInput, never> => ({
  id: 'send_feedback',
  description:
    'Send the user’s feedback about TinyTinkerer to the maintainers. Use when the user wants to report a bug, suggest an idea, or share praise.',
  schema: feedbackInputSchema,
  execute(input): Promise<never> {
    // No backend: route the feedback to telemetry (via the capture sink wired by
    // the registry) and surface a failure to the runtime. A rejected promise
    // (rather than a synchronous throw) means every caller observes it uniformly.
    return Promise.reject(new FeedbackPendingError(input))
  }
})

// The feedback plugin. Contributes a single send_feedback tool; needs no
// activate/deactivate lifecycle. The host (app-browser) supplies the capture
// sink that forwards reports to telemetry.
export const feedbackPlugin = (): AgentPlugin => ({
  id: SEND_FEEDBACK_PLUGIN_ID,
  createTools: (): Tool<unknown, unknown>[] => [createSendFeedbackTool()]
})
