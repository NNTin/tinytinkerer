import { z } from 'zod'

export const PIXEL_AGENTS_BRIDGE_CHANNEL = 'tinytinkerer:pixel-agents:v1'

export const pixelAgentMetaSchema = z.object({
  palette: z.number().optional(),
  hueShift: z.number().optional(),
  seatId: z.string().optional()
})
export type PixelAgentMeta = z.infer<typeof pixelAgentMetaSchema>

export type PixelServerMessage =
  | { type: 'providerCapabilities'; readingTools: string[]; subagentToolNames: string[] }
  | { type: 'characterSpritesLoaded'; characters: unknown[] }
  | { type: 'petSpritesLoaded'; pets: unknown[]; petNames: string[] }
  | { type: 'floorTilesLoaded'; sprites: unknown[] }
  | { type: 'wallTilesLoaded'; sets: unknown[] }
  | { type: 'furnitureAssetsLoaded'; catalog: unknown[]; sprites: Record<string, unknown> }
  | {
      type: 'existingAgents'
      agents: number[]
      agentMeta: Record<string, PixelAgentMeta>
      folderNames: Record<string, string>
      externalAgents: Record<string, boolean>
    }
  | { type: 'layoutLoaded'; layout: Record<string, unknown> | null }
  | {
      type: 'settingsLoaded'
      soundEnabled: boolean
      lastSeenVersion: string
      extensionVersion: string
      watchAllSessions: boolean
      alwaysShowLabels: boolean
      hooksEnabled: boolean
      hooksInfoShown: boolean
      externalAssetDirectories: string[]
    }
  // One agent per conversation (issue #430): a new conversation announces
  // itself dynamically instead of only ever appearing in the bootstrap
  // `existingAgents` list. Shape matches the upstream `AgentCreated` message
  // exactly (`core/src/messages.ts`); `folderName` carries the conversation
  // title, mirroring `folderNames[agentId]` in `existingAgents`.
  | { type: 'agentCreated'; id: number; folderName?: string }
  // A deleted conversation's agent leaves the office. Matches upstream's
  // `AgentClosed` exactly — no extra fields.
  | { type: 'agentClosed'; id: number }
  | { type: 'agentSelected'; id: number }
  | { type: 'agentStatus'; id: number; status: 'active' | 'waiting'; awaitingInput?: boolean }
  | {
      type: 'agentToolStart'
      id: number
      toolId: string
      status: string
      toolName?: string
    }
  | { type: 'agentToolDone'; id: number; toolId: string }
  | { type: 'agentToolsClear'; id: number }

// `saveAgentSeats` seats are keyed by the upstream's own agent id; unknown-shaped
// entries reject the whole message rather than silently dropping just that seat.
const seatRecordSchema = z.object({
  palette: z.number(),
  hueShift: z.number(),
  seatId: z.string().nullable()
})

const pixelClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('webviewReady') }),
  z.object({
    type: z.literal('saveLayout'),
    // Opaque passthrough: the upstream layout shape is not this bridge's concern.
    layout: z.record(z.string(), z.unknown())
  }),
  z.object({
    type: z.literal('saveAgentSeats'),
    seats: z.record(z.string(), seatRecordSchema)
  }),
  // Office toolbar "+ Agent": starts a new conversation. Upstream's shape
  // carries an optional multi-workspace folder picker and a bypass-permissions
  // flag (`core/src/messages.ts` `LaunchAgent`); we have exactly one
  // TinyTinkerer "workspace" (the chat store), so both are accepted (never
  // rejected) and simply ignored rather than validated against a meaning we
  // don't have.
  z.object({
    type: z.literal('launchAgent'),
    folderPath: z.string().optional(),
    bypassPermissions: z.boolean().optional()
  }),
  // Clicking a character: make its conversation active in the assistant panel.
  z.object({
    type: z.literal('focusAgent'),
    id: z.number()
  }),
  // The office's own "×" close affordance on a selected character.
  z.object({
    type: z.literal('closeAgent'),
    id: z.number()
  })
])
export type PixelClientMessage = z.infer<typeof pixelClientMessageSchema>

const pixelClientEnvelopeSchema = z.object({
  channel: z.literal(PIXEL_AGENTS_BRIDGE_CHANNEL),
  direction: z.literal('client'),
  payload: z.string()
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const parsePixelClientEnvelope = (value: unknown): PixelClientMessage | null => {
  const envelope = pixelClientEnvelopeSchema.safeParse(value)
  if (!envelope.success) return null
  let payload: unknown
  try {
    payload = JSON.parse(envelope.data.payload)
  } catch {
    return null
  }
  const message = pixelClientMessageSchema.safeParse(payload)
  return message.success ? message.data : null
}

const pixelAgentsBootstrapSchema = z.object({
  integrationVersion: z.literal(1),
  upstream: z.object({ commit: z.string(), version: z.string() }),
  assets: z.object({
    // Opaque passthrough asset arrays: these are pre-decoded upstream sprite/tile
    // data this bridge never inspects, only forwards.
    characters: z.array(z.unknown()),
    pets: z.array(z.unknown()),
    petNames: z.array(z.string()),
    floors: z.array(z.unknown()),
    walls: z.array(z.unknown()),
    furnitureCatalog: z.array(z.unknown()),
    furnitureSprites: z.record(z.string(), z.unknown())
  }),
  defaultLayout: z.record(z.string(), z.unknown()).nullable()
})
export type PixelAgentsBootstrap = z.infer<typeof pixelAgentsBootstrapSchema>

export const parsePixelAgentsBootstrap = (value: unknown): PixelAgentsBootstrap => {
  // Checked ahead of the full shape parse so a missing/wrong integration version
  // gets its own distinct, more actionable error message.
  if (!isRecord(value) || value.integrationVersion !== 1) {
    throw new Error('Unsupported Pixel Agents bootstrap data')
  }
  const result = pixelAgentsBootstrapSchema.safeParse(value)
  if (!result.success) {
    throw new Error('Invalid Pixel Agents bootstrap data')
  }
  return result.data
}

// One conversation's worth of bootstrap-time state (issue #430): the stage
// resolves every current conversation to an agent number before calling this,
// so by the time it runs there is no more conversation/store awareness here —
// just the flat per-agent facts the office protocol wants.
export type PixelBootstrapAgent = {
  agentId: number
  title: string
  isRunning: boolean
  awaitingInput: boolean
}

export const createPixelBootstrapMessages = (
  bootstrap: PixelAgentsBootstrap,
  layout: Record<string, unknown> | null,
  agents: readonly PixelBootstrapAgent[],
  agentMeta: Record<number, PixelAgentMeta>,
  // The conversation the assistant panel currently shows, i.e. which office
  // character upstream should highlight as selected. `undefined` when there is
  // no active conversation yet (or it isn't one of `agents`, e.g. mid-delete) —
  // no `agentSelected` message is emitted in that case, matching upstream's own
  // "nothing selected" state.
  activeAgentId: number | undefined
): PixelServerMessage[] => [
  { type: 'providerCapabilities', readingTools: ['Read'], subagentToolNames: [] },
  { type: 'characterSpritesLoaded', characters: bootstrap.assets.characters },
  {
    type: 'petSpritesLoaded',
    pets: bootstrap.assets.pets,
    petNames: bootstrap.assets.petNames
  },
  { type: 'floorTilesLoaded', sprites: bootstrap.assets.floors },
  { type: 'wallTilesLoaded', sets: bootstrap.assets.walls },
  {
    type: 'furnitureAssetsLoaded',
    catalog: bootstrap.assets.furnitureCatalog,
    sprites: bootstrap.assets.furnitureSprites
  },
  {
    type: 'existingAgents',
    agents: agents.map((agent) => agent.agentId),
    agentMeta: Object.fromEntries(Object.entries(agentMeta)),
    folderNames: Object.fromEntries(agents.map((agent) => [agent.agentId, agent.title])),
    externalAgents: Object.fromEntries(agents.map((agent) => [agent.agentId, false]))
  },
  { type: 'layoutLoaded', layout: layout ?? bootstrap.defaultLayout },
  {
    type: 'settingsLoaded',
    soundEnabled: false,
    lastSeenVersion: bootstrap.upstream.version,
    extensionVersion: bootstrap.upstream.version,
    watchAllSessions: false,
    alwaysShowLabels: true,
    hooksEnabled: true,
    hooksInfoShown: true,
    externalAssetDirectories: []
  },
  ...(activeAgentId !== undefined ? [{ type: 'agentSelected', id: activeAgentId } as const] : []),
  ...agents.map(
    (agent): PixelServerMessage => ({
      type: 'agentStatus',
      id: agent.agentId,
      status: agent.isRunning ? 'active' : 'waiting',
      ...(!agent.isRunning ? { awaitingInput: agent.awaitingInput } : {})
    })
  )
]
