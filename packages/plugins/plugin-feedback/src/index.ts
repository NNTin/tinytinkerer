import {
  feedbackInputSchema,
  PluginCaptureError,
  type AgentPlugin,
  type FeedbackInput,
  type PluginManifest,
  type PluginModule,
  type Tool
} from '@tinytinkerer/contracts'

// Stable id used as the activation key and capture tag. Must match the manifest
// id surfaced in the Settings Modal.
export const SEND_FEEDBACK_PLUGIN_ID = 'send-feedback'

// UI + planner metadata for the host. The shape is the generic PluginManifest
// contract from contracts; this plugin ships its own copy and tool descriptors.
export const feedbackPluginManifest: PluginManifest = {
  id: SEND_FEEDBACK_PLUGIN_ID,
  label: 'Feedback (send_feedback tool)',
  description:
    "Report a bug or suggest an improvement through the assistant — it can also flag its own limitations as ideas. Unlike other plugins this tool helps me rather than you directly, so the assistant may perform slightly worse while it's on. Leaving it on is a small way to support the project — think of it as buying me a coffee. Off by default.",
  toolDescriptors: [
    {
      id: 'send_feedback',
      description:
        'Report a bug or suggest an improvement for TinyTinkerer to the maintainers. ' +
        'Invoke it in two situations: (1) when the user asks to report a bug or share an ' +
        'idea/improvement; (2) proactively, on your own initiative, when you hit a limitation ' +
        'in your own environment — a tool, capability, permission, or context you needed but ' +
        'did not have to fully help the user. In case (2) send category "idea" describing what ' +
        'you were trying to do and what was missing. Do not ask permission to send feedback ' +
        'about your own limitations; just send it once, then continue helping as best you can. ' +
        'Send at most one feedback per limitation and avoid duplicates within a conversation.',
      // Canonical schema (issue #287): the SAME Zod schema the tool validates against
      // (see createSendFeedbackTool). The host generates the planner-visible JSON
      // Schema from it; planner prose now lives on the schema's `.describe()` calls.
      schema: feedbackInputSchema
    }
  ]
}

// Thrown by the send_feedback tool. Carries the feedback as a structured report
// so the agent-core plugin registry routes it to the host capture sink (Sentry
// in the browser), then signals that no backend exists yet via "not implemented".
// Feedback is not an error condition, so the report is `info`-level: the host
// captures it as an informational Sentry *message*, not an error issue.
export class FeedbackPendingError extends PluginCaptureError {
  constructor(input: FeedbackInput) {
    super(
      {
        pluginId: SEND_FEEDBACK_PLUGIN_ID,
        kind: 'feedback',
        level: 'info',
        message: `Feedback (${input.category}): ${input.message}`,
        contexts: {
          feedback: {
            category: input.category,
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
    'Report a bug or suggest an improvement for TinyTinkerer to the maintainers. Use it when ' +
    'the user asks to report a bug or share an idea, and also proactively when you hit a ' +
    'limitation in your own environment (a missing tool, capability, or permission) — send ' +
    'category "idea" describing what you needed. category is required: "bug" or "idea".',
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

// PluginModule contract surface: the named exports a host discovers dynamically.
// `manifest` and `createPlugin` are the only members the host relies on, so a
// host never needs to know this package by name.
export const manifest: PluginManifest = feedbackPluginManifest
export const createPlugin: PluginModule['createPlugin'] = feedbackPlugin
