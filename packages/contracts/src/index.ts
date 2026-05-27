import { z } from 'zod'
import type {
  BlockNode as ContentBlockNode,
  ContentDocument as CoreContentDocument,
  InlineNode as ContentInlineNode,
  ListItemNode as ContentListItemNode,
  TableAlignment as ContentTableAlignment,
  TableCell as ContentTableCell
} from '@tinytinkerer/content-core'

export const eventTypeSchema = z.enum([
  'user.message',
  'planning.started',
  'plan.generated',
  'execution.started',
  'execution.step.started',
  'tool.call.started',
  'tool.call.completed',
  'tool.call.failed',
  'execution.step.completed',
  'execution.completed',
  'rate.limit.waiting',
  'rate.limit.recovered',
  'rate.limit.cancelled',
  'assistant.chunk',
  'assistant.done',
  'error',
  'system'
])

export type EventType = z.infer<typeof eventTypeSchema>

export const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string()
})

export type SearchResult = z.infer<typeof searchResultSchema>

export const planComplexitySchema = z.enum(['low', 'medium', 'high'])
export type PlanComplexity = z.infer<typeof planComplexitySchema>

export const toolCallSchema = z.object({
  toolId: z.string(),
  input: z.record(z.string(), z.unknown())
})

export const planStepSchema = z.object({
  id: z.string(),
  summary: z.string(),
  toolCall: toolCallSchema.optional()
})

export type PlanStep = z.infer<typeof planStepSchema>

export const executionPlanSchema = z.object({
  complexity: planComplexitySchema,
  steps: z.array(planStepSchema)
})

export type ExecutionPlan = z.infer<typeof executionPlanSchema>

const nodeIdSchema = z.string()

export type AssistantInlineNode = ContentInlineNode
export type AssistantTableCell = ContentTableCell
export type AssistantTableAlignment = ContentTableAlignment
export type AssistantListItemNode = ContentListItemNode
export type AssistantBlockNode = ContentBlockNode
export type AssistantContentDocument = CoreContentDocument

export const assistantInlineNodeSchema: z.ZodType<AssistantInlineNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      id: nodeIdSchema.optional(),
      value: z.string()
    }),
    z.object({
      type: z.literal('emphasis'),
      id: nodeIdSchema.optional(),
      children: z.array(assistantInlineNodeSchema)
    }),
    z.object({
      type: z.literal('strong'),
      id: nodeIdSchema.optional(),
      children: z.array(assistantInlineNodeSchema)
    }),
    z.object({
      type: z.literal('strikethrough'),
      id: nodeIdSchema.optional(),
      children: z.array(assistantInlineNodeSchema)
    }),
    z.object({
      type: z.literal('codeInline'),
      id: nodeIdSchema.optional(),
      value: z.string()
    }),
    z.object({
      type: z.literal('link'),
      id: nodeIdSchema.optional(),
      url: z.string(),
      title: z.string().optional(),
      children: z.array(assistantInlineNodeSchema)
    }),
    z.object({
      type: z.literal('imageInline'),
      id: nodeIdSchema.optional(),
      url: z.string(),
      alt: z.string(),
      title: z.string().optional()
    }),
    z.object({
      type: z.literal('break'),
      id: nodeIdSchema.optional()
    })
  ])
)

export const assistantTableCellSchema = z.array(assistantInlineNodeSchema)

export const assistantTableAlignmentSchema = z.union([
  z.literal('left'),
  z.literal('center'),
  z.literal('right'),
  z.null()
])

export const assistantBlockNodeSchema: z.ZodType<AssistantBlockNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('heading'),
      id: nodeIdSchema.optional(),
      level: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6)
      ]),
      children: z.array(assistantInlineNodeSchema)
    }),
    z.object({
      type: z.literal('paragraph'),
      id: nodeIdSchema.optional(),
      children: z.array(assistantInlineNodeSchema)
    }),
    z.object({
      type: z.literal('list'),
      id: nodeIdSchema.optional(),
      ordered: z.boolean(),
      start: z.number().int().optional(),
      children: z.array(assistantListItemNodeSchema)
    }),
    z.object({
      type: z.literal('blockquote'),
      id: nodeIdSchema.optional(),
      children: z.array(assistantBlockNodeSchema)
    }),
    z.object({
      type: z.literal('thematicBreak'),
      id: nodeIdSchema.optional()
    }),
    z.object({
      type: z.literal('codeBlock'),
      id: nodeIdSchema.optional(),
      code: z.string(),
      language: z.string().optional()
    }),
    z.object({
      type: z.literal('choicePrompt'),
      id: nodeIdSchema.optional(),
      prompt: z.string(),
      choices: z.array(z.string())
    }),
    z.object({
      type: z.literal('table'),
      id: nodeIdSchema.optional(),
      align: z.array(assistantTableAlignmentSchema),
      header: z.array(assistantTableCellSchema),
      rows: z.array(z.array(assistantTableCellSchema))
    }),
    z.object({
      type: z.literal('image'),
      id: nodeIdSchema.optional(),
      url: z.string(),
      alt: z.string(),
      title: z.string().optional()
    })
  ])
)

export const assistantListItemNodeSchema: z.ZodType<AssistantListItemNode> = z.lazy(() =>
  z.object({
    type: z.literal('listItem'),
    id: nodeIdSchema.optional(),
    checked: z.boolean().nullable().optional(),
    children: z.array(assistantBlockNodeSchema)
  })
)

export const assistantContentDocumentSchema: z.ZodType<AssistantContentDocument> = z.object({
  nodes: z.array(assistantBlockNodeSchema)
})

const eventBaseSchema = <TType extends EventType, TPayload extends z.ZodTypeAny>(
  type: TType,
  payload: TPayload
) =>
  z.object({
    id: z.string(),
    timestamp: z.string(),
    type: z.literal(type),
    payload
  })

export const userMessageEventSchema = eventBaseSchema(
  'user.message',
  z.object({ text: z.string() })
)
export const planningStartedEventSchema = eventBaseSchema(
  'planning.started',
  z.object({ summary: z.string() })
)
export const planGeneratedEventSchema = eventBaseSchema(
  'plan.generated',
  z.object({ plan: executionPlanSchema })
)
export const executionStartedEventSchema = eventBaseSchema(
  'execution.started',
  z.object({ steps: z.number().int().nonnegative() })
)
export const executionStepStartedEventSchema = eventBaseSchema(
  'execution.step.started',
  z.object({ step: planStepSchema, index: z.number().int().nonnegative() })
)
export const toolCallStartedEventSchema = eventBaseSchema(
  'tool.call.started',
  z.object({ toolId: z.string(), input: z.record(z.string(), z.unknown()) })
)
export const toolCallCompletedEventSchema = eventBaseSchema(
  'tool.call.completed',
  z.object({ toolId: z.string(), output: z.unknown() })
)
export const toolCallFailedEventSchema = eventBaseSchema(
  'tool.call.failed',
  z.object({ toolId: z.string(), error: z.string() })
)
export const executionStepCompletedEventSchema = eventBaseSchema(
  'execution.step.completed',
  z.object({ stepId: z.string(), note: z.string() })
)
export const executionCompletedEventSchema = eventBaseSchema(
  'execution.completed',
  z.object({ steps: z.number().int().nonnegative() })
)
export const rateLimitWaitingEventSchema = eventBaseSchema(
  'rate.limit.waiting',
  z.object({
    retryAfterMs: z.number().nonnegative(),
    retryAt: z.string(),
    message: z.string(),
    autoRetry: z.boolean()
  })
)
export const rateLimitRecoveredEventSchema = eventBaseSchema(
  'rate.limit.recovered',
  z.object({ retryAt: z.string() })
)
export const rateLimitCancelledEventSchema = eventBaseSchema(
  'rate.limit.cancelled',
  z.object({
    retryAfterMs: z.number().nonnegative(),
    retryAt: z.string(),
    message: z.string(),
    reason: z.enum(['too_long', 'cancelled'])
  })
)
export const assistantChunkEventSchema = eventBaseSchema(
  'assistant.chunk',
  z.object({
    source: z.string(),
    content: assistantContentDocumentSchema
  })
)
export const assistantDoneEventSchema = eventBaseSchema(
  'assistant.done',
  z.object({
    source: z.string(),
    content: assistantContentDocumentSchema
  })
)
export const errorEventSchema = eventBaseSchema(
  'error',
  z.object({ message: z.string() })
)
export const systemEventSchema = eventBaseSchema(
  'system',
  z.object({
    message: z.string(),
    level: z.enum(['info', 'warning', 'error'])
  })
)

export const chatEventSchema = z.discriminatedUnion('type', [
  userMessageEventSchema,
  planningStartedEventSchema,
  planGeneratedEventSchema,
  executionStartedEventSchema,
  executionStepStartedEventSchema,
  toolCallStartedEventSchema,
  toolCallCompletedEventSchema,
  toolCallFailedEventSchema,
  executionStepCompletedEventSchema,
  executionCompletedEventSchema,
  rateLimitWaitingEventSchema,
  rateLimitRecoveredEventSchema,
  rateLimitCancelledEventSchema,
  assistantChunkEventSchema,
  assistantDoneEventSchema,
  errorEventSchema,
  systemEventSchema
])

export type UserMessageEvent = z.infer<typeof userMessageEventSchema>
export type PlanningStartedEvent = z.infer<typeof planningStartedEventSchema>
export type PlanGeneratedEvent = z.infer<typeof planGeneratedEventSchema>
export type ExecutionStartedEvent = z.infer<typeof executionStartedEventSchema>
export type ExecutionStepStartedEvent = z.infer<typeof executionStepStartedEventSchema>
export type ToolCallStartedEvent = z.infer<typeof toolCallStartedEventSchema>
export type ToolCallCompletedEvent = z.infer<typeof toolCallCompletedEventSchema>
export type ToolCallFailedEvent = z.infer<typeof toolCallFailedEventSchema>
export type ExecutionStepCompletedEvent = z.infer<typeof executionStepCompletedEventSchema>
export type ExecutionCompletedEvent = z.infer<typeof executionCompletedEventSchema>
export type RateLimitWaitingEvent = z.infer<typeof rateLimitWaitingEventSchema>
export type RateLimitRecoveredEvent = z.infer<typeof rateLimitRecoveredEventSchema>
export type RateLimitCancelledEvent = z.infer<typeof rateLimitCancelledEventSchema>
export type AssistantChunkEvent = z.infer<typeof assistantChunkEventSchema>
export type AssistantDoneEvent = z.infer<typeof assistantDoneEventSchema>
export type ErrorEvent = z.infer<typeof errorEventSchema>
export type SystemEvent = z.infer<typeof systemEventSchema>
export type ChatEvent = z.infer<typeof chatEventSchema>

export const serviceStatusSchema = z.object({
  state: z.enum(['ready', 'degraded', 'offline']),
  detail: z.string(),
  error: z.string().optional()
})

export type ServiceStatus = z.infer<typeof serviceStatusSchema>

export const systemStatusSchema = z.object({
  auth: serviceStatusSchema,
  models: serviceStatusSchema,
  search: serviceStatusSchema
})

export type SystemStatus = z.infer<typeof systemStatusSchema>

export const githubExchangeRequestSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url().optional()
})

export const githubExchangeResponseSchema = z.object({
  accessToken: z.string().optional(),
  error: z.string().optional()
})

export type GitHubExchangeRequest = z.infer<typeof githubExchangeRequestSchema>
export type GitHubExchangeResponse = z.infer<typeof githubExchangeResponseSchema>

export const edgeErrorResponseSchema = z.object({
  error: z.string()
})

export type EdgeErrorResponse = z.infer<typeof edgeErrorResponseSchema>

export const searchRequestSchema = z.object({
  query: z.string().min(2).max(500),
  maxResults: z.number().int().positive().max(10).optional()
})

export const searchResponseSchema = z.object({
  query: z.string(),
  results: z.array(searchResultSchema)
})

export type SearchRequest = z.infer<typeof searchRequestSchema>
export type SearchResponse = z.infer<typeof searchResponseSchema>

export const brandLinkRelSchema = z.enum(['icon', 'apple-touch-icon', 'mask-icon'])
export type BrandLinkRel = z.infer<typeof brandLinkRelSchema>

export const brandLinkAssetSchema = z.object({
  rel: brandLinkRelSchema,
  href: z.string().min(1),
  type: z.string().min(1).optional(),
  sizes: z.string().min(1).optional(),
  color: z.string().min(1).optional()
})
export type BrandLinkAsset = z.infer<typeof brandLinkAssetSchema>

export const brandThemeMetadataSchema = z.object({
  applicationName: z.string().min(1),
  themeColor: z.string().min(1),
  backgroundColor: z.string().min(1)
})
export type BrandThemeMetadata = z.infer<typeof brandThemeMetadataSchema>

export const brandManifestIconPurposeSchema = z.enum(['any', 'maskable', 'monochrome'])
export type BrandManifestIconPurpose = z.infer<typeof brandManifestIconPurposeSchema>

export const brandManifestIconSchema = z.object({
  src: z.string().min(1),
  sizes: z.string().min(1),
  type: z.string().min(1),
  purpose: brandManifestIconPurposeSchema.optional()
})
export type BrandManifestIcon = z.infer<typeof brandManifestIconSchema>

export const brandManifestDisplaySchema = z.enum([
  'fullscreen',
  'standalone',
  'minimal-ui',
  'browser'
])
export type BrandManifestDisplay = z.infer<typeof brandManifestDisplaySchema>

export const brandManifestSchema = z.object({
  name: z.string().min(1),
  shortName: z.string().min(1),
  description: z.string().min(1).optional(),
  startUrl: z.string().min(1),
  display: brandManifestDisplaySchema,
  backgroundColor: z.string().min(1),
  themeColor: z.string().min(1),
  icons: z.array(brandManifestIconSchema).min(1)
})
export type BrandManifest = z.infer<typeof brandManifestSchema>

export const brandDefinitionSchema = z.object({
  theme: brandThemeMetadataSchema,
  links: z.array(brandLinkAssetSchema).min(1),
  manifest: brandManifestSchema
})
export type BrandDefinition = z.infer<typeof brandDefinitionSchema>

export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(32_000)
})

export const modelsChatRequestSchema = z.object({
  model: z.string().optional(),
  stream: z.boolean().optional(),
  messages: z.array(chatMessageSchema).max(100)
})

export const modelsChatChoiceSchema = z.object({
  message: z
    .object({
      role: z.string().optional(),
      content: z.string().nullable().optional()
    })
    .optional(),
  finish_reason: z.string().optional()
})

export const modelsChatResponseSchema = z.object({
  choices: z.array(modelsChatChoiceSchema).optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional()
    })
    .optional()
})

export type ChatMessage = z.infer<typeof chatMessageSchema>
export type ModelsChatRequest = z.infer<typeof modelsChatRequestSchema>
export type ModelsChatResponse = z.infer<typeof modelsChatResponseSchema>

export const rateLimitPayloadSchema = z.object({
  code: z.literal('rate_limited'),
  error: z.string(),
  retryAfterMs: z.number().nonnegative(),
  retryAt: z.string()
})

export type RateLimitPayload = z.infer<typeof rateLimitPayloadSchema>

export const parseRetryAfterMs = (
  value: string | null | undefined,
  nowMs = Date.now()
): number | undefined => {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000)
  }

  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - nowMs)
  }

  return undefined
}

export const githubModelEntrySchema = z.object({
  id: z.string(),
  label: z.string()
})

export const modelsListResponseSchema = z.object({
  models: z.array(githubModelEntrySchema)
})

export type GitHubModelEntry = z.infer<typeof githubModelEntrySchema>
export type ModelsListResponse = z.infer<typeof modelsListResponseSchema>
