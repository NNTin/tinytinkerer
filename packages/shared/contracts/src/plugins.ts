import { z } from 'zod'

// Plugin contracts — schemas and inferred types shared by the agent-core plugin
// layer, the plugin packages, app-core settings orchestration, and the
// app-browser Settings Modal. These are NOT edge DTOs (plugins have no backend
// route today), so they live in their own module rather than ./edge.

// Categories a user can attach to feedback. `general` is the implicit default
// when the model (or UI) does not specify one.
export const feedbackCategorySchema = z.enum(['bug', 'idea', 'praise', 'general'])
export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>

// Input contract for the `send_feedback` tool exposed by the feedback plugin.
// `message` is user-authored content; routing it to telemetry is an intentional
// privacy exception gated behind both plugin activation and telemetry consent.
export const feedbackInputSchema = z.object({
  message: z.string().min(1).max(2000),
  category: feedbackCategorySchema.optional()
})
export type FeedbackInput = z.infer<typeof feedbackInputSchema>

// Persisted activation state for optional plugins: a map of pluginId -> enabled.
// A missing entry means "not activated"; all plugins are off by default.
export const pluginActivationStateSchema = z.record(z.string(), z.boolean())
export type PluginActivationState = z.infer<typeof pluginActivationStateSchema>
