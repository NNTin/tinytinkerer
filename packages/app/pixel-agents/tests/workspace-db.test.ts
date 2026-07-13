import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceStore } from '@tinytinkerer/app-shell'
import {
  loadPixelAgentsWorkspace,
  savePixelAgentsWorkspace,
  type PixelAgentsWorkspaceRecord
} from '../src/workspace-db'

describe('Pixel Agents workspace persistence', () => {
  it('persists the layout and stable agent appearance as one workspace', async () => {
    const save = vi.fn<(value: PixelAgentsWorkspaceRecord) => Promise<void>>().mockResolvedValue()
    const store: WorkspaceStore<PixelAgentsWorkspaceRecord> = {
      load: vi.fn().mockResolvedValue(null),
      save
    }

    await savePixelAgentsWorkspace(
      { layout: { version: 1 }, agentMeta: { palette: 3, hueShift: 12, seatId: 'desk-1' } },
      store
    )

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'default',
        layout: { version: 1 },
        agentMeta: { palette: 3, hueShift: 12, seatId: 'desk-1' }
      })
    )
    await expect(loadPixelAgentsWorkspace(store)).resolves.toBeNull()
  })
})
