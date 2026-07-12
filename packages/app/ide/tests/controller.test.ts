import { describe, expect, it, vi } from 'vitest'
import { createIdeControllerHandle, type IdeController } from '../src/controller'

const inspectWorkspace = vi.fn(() => ({ ok: true }))
const undoLastChange = vi.fn(() => Promise.resolve(true))

const controller = (): IdeController => ({
  inspectWorkspace,
  searchFiles: vi.fn(() => ({ results: [] })),
  readFiles: vi.fn(() => ({ files: [] })),
  applyFileChanges: vi.fn(() => Promise.resolve({ changes: [] })),
  inspectRuntime: vi.fn(() => ({ status: 'idle' })),
  restartRuntime: vi.fn(() => Promise.resolve({ restarted: true })),
  undoLastChange
})

describe('IDE controller handle', () => {
  it('fails fast while the IDE is loading', async () => {
    const handle = createIdeControllerHandle()
    await expect(handle.request('inspectWorkspace')).rejects.toThrow(/still loading/)
  })

  it('routes requests and undo to the mounted controller', async () => {
    const handle = createIdeControllerHandle()
    const target = controller()
    handle.setController(target)
    await expect(handle.request('inspectWorkspace', {})).resolves.toEqual({ ok: true })
    await expect(handle.undoLastChange()).resolves.toBe(true)
    expect(inspectWorkspace).toHaveBeenCalledOnce()
    expect(undoLastChange).toHaveBeenCalledOnce()
  })
})
