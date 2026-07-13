export const PIXEL_AGENTS_BRIDGE_CHANNEL = 'tinytinkerer:pixel-agents:v1'
export const PIXEL_AGENT_ID = 1

export type PixelAgentMeta = {
  palette?: number
  hueShift?: number
  seatId?: string
}

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

export type PixelClientMessage =
  | { type: 'webviewReady' }
  | { type: 'saveLayout'; layout: Record<string, unknown> }
  | {
      type: 'saveAgentSeats'
      seats: Record<string, { palette: number; hueShift: number; seatId: string | null }>
    }

type PixelClientEnvelope = {
  channel: typeof PIXEL_AGENTS_BRIDGE_CHANNEL
  direction: 'client'
  payload: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const parsePixelClientEnvelope = (value: unknown): PixelClientMessage | null => {
  if (!value || typeof value !== 'object') return null
  const envelope = value as Partial<PixelClientEnvelope>
  if (
    envelope.channel !== PIXEL_AGENTS_BRIDGE_CHANNEL ||
    envelope.direction !== 'client' ||
    typeof envelope.payload !== 'string'
  )
    return null
  try {
    const message: unknown = JSON.parse(envelope.payload)
    if (!isRecord(message)) return null
    if (message.type === 'webviewReady') return { type: 'webviewReady' }
    if (message.type === 'saveLayout' && isRecord(message.layout)) {
      return { type: 'saveLayout', layout: message.layout }
    }
    if (message.type === 'saveAgentSeats' && isRecord(message.seats)) {
      const seats: Record<string, { palette: number; hueShift: number; seatId: string | null }> = {}
      for (const [id, value] of Object.entries(message.seats)) {
        if (
          !isRecord(value) ||
          typeof value.palette !== 'number' ||
          typeof value.hueShift !== 'number' ||
          (value.seatId !== null && typeof value.seatId !== 'string')
        )
          return null
        seats[id] = {
          palette: value.palette,
          hueShift: value.hueShift,
          seatId: value.seatId
        }
      }
      return { type: 'saveAgentSeats', seats }
    }
    return null
  } catch {
    return null
  }
}

export type PixelAgentsBootstrap = {
  integrationVersion: 1
  upstream: { commit: string; version: string }
  assets: {
    characters: unknown[]
    pets: unknown[]
    petNames: string[]
    floors: unknown[]
    walls: unknown[]
    furnitureCatalog: unknown[]
    furnitureSprites: Record<string, unknown>
  }
  defaultLayout: Record<string, unknown> | null
}

export const parsePixelAgentsBootstrap = (value: unknown): PixelAgentsBootstrap => {
  if (!isRecord(value) || value.integrationVersion !== 1) {
    throw new Error('Unsupported Pixel Agents bootstrap data')
  }
  const upstream = value.upstream
  const assets = value.assets
  if (
    !isRecord(upstream) ||
    typeof upstream.commit !== 'string' ||
    typeof upstream.version !== 'string' ||
    !isRecord(assets) ||
    !Array.isArray(assets.characters) ||
    !Array.isArray(assets.pets) ||
    !Array.isArray(assets.petNames) ||
    !assets.petNames.every((name) => typeof name === 'string') ||
    !Array.isArray(assets.floors) ||
    !Array.isArray(assets.walls) ||
    !Array.isArray(assets.furnitureCatalog) ||
    !isRecord(assets.furnitureSprites) ||
    (value.defaultLayout !== null && !isRecord(value.defaultLayout))
  ) {
    throw new Error('Invalid Pixel Agents bootstrap data')
  }
  return value as PixelAgentsBootstrap
}

export const createPixelBootstrapMessages = (
  bootstrap: PixelAgentsBootstrap,
  layout: Record<string, unknown> | null,
  agentMeta: PixelAgentMeta,
  isRunning: boolean,
  awaitingInput: boolean
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
    agents: [PIXEL_AGENT_ID],
    agentMeta: { [PIXEL_AGENT_ID]: agentMeta },
    folderNames: { [PIXEL_AGENT_ID]: 'TinyTinkerer' },
    externalAgents: { [PIXEL_AGENT_ID]: false }
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
  { type: 'agentSelected', id: PIXEL_AGENT_ID },
  {
    type: 'agentStatus',
    id: PIXEL_AGENT_ID,
    status: isRunning ? 'active' : 'waiting',
    ...(!isRunning ? { awaitingInput } : {})
  }
]
