import { createWorkspaceStore, type WorkspaceStore } from '@tinytinkerer/app-shell'
import type { PixelAgentMeta } from './protocol'

const PIXEL_AGENTS_DATABASE_NAME = 'tinytinkerer-pixel-agents'

export type PixelAgentsWorkspaceRecord = {
  id: 'default'
  layout: Record<string, unknown> | null
  agentMeta: PixelAgentMeta
  updatedAt: string
}

const pixelAgentsWorkspaceStore = createWorkspaceStore<PixelAgentsWorkspaceRecord>(
  PIXEL_AGENTS_DATABASE_NAME
)

export const loadPixelAgentsWorkspace = (
  store: WorkspaceStore<PixelAgentsWorkspaceRecord> = pixelAgentsWorkspaceStore
): Promise<PixelAgentsWorkspaceRecord | null> => store.load()

export const savePixelAgentsWorkspace = (
  workspace: Pick<PixelAgentsWorkspaceRecord, 'layout' | 'agentMeta'>,
  store: WorkspaceStore<PixelAgentsWorkspaceRecord> = pixelAgentsWorkspaceStore
): Promise<void> => store.save({ id: 'default', ...workspace, updatedAt: new Date().toISOString() })
