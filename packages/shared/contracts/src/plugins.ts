import { z } from 'zod'

// Plugin contracts — schemas and inferred types shared by the agent-core plugin
// layer, the plugin packages, app-core settings orchestration, and the
// app-browser Settings Modal. These are NOT edge DTOs (plugins have no backend
// route today), so they live in their own module rather than ./edge.

// The two kinds of feedback the tool accepts: a defect report, or a suggested
// improvement/feature idea. There is no neutral catch-all — the sender (user or
// agent) must classify the feedback so the maintainers can triage it.
export const feedbackCategorySchema = z.enum(['bug', 'idea'])
export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>

// Input contract for the `send_feedback` tool exposed by the feedback plugin.
// `message` is sender-authored content; routing it to telemetry is an intentional
// privacy exception gated behind both plugin activation and telemetry consent.
// `category` is required so every report is classified as a bug or an idea.
export const feedbackInputSchema = z.object({
  message: z.string().min(1).max(2000),
  category: feedbackCategorySchema
})
export type FeedbackInput = z.infer<typeof feedbackInputSchema>

// Persisted activation state for optional plugins: a map of pluginId -> enabled.
// A missing entry means "not activated"; all plugins are off by default.
export const pluginActivationStateSchema = z.record(z.string(), z.boolean())
export type PluginActivationState = z.infer<typeof pluginActivationStateSchema>
