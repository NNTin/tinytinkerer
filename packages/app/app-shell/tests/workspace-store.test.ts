import { beforeEach, describe, expect, it, vi } from 'vitest'

const dexie = vi.hoisted(() => ({
  constructors: 0,
  get: vi.fn(),
  put: vi.fn(),
  stores: vi.fn()
}))

vi.mock('dexie', () => ({
  default: class FakeDexie {
    constructor(readonly name: string) {
      dexie.constructors += 1
    }

    version() {
      return { stores: dexie.stores }
    }

    table() {
      return { get: dexie.get, put: dexie.put }
    }
  }
}))

import { createWorkspaceStore } from '../src/workspace-store'

type TestWorkspace = { id: 'default'; value: string; updatedAt: string }

beforeEach(() => {
  dexie.constructors = 0
  dexie.get.mockReset()
  dexie.put.mockReset()
  dexie.stores.mockReset()
})

describe('createWorkspaceStore', () => {
  it('creates version-one storage lazily and reuses it', async () => {
    const store = createWorkspaceStore<TestWorkspace>('test-workspace')
    expect(dexie.constructors).toBe(0)
    dexie.get.mockResolvedValue(undefined)

    await expect(store.load()).resolves.toBeNull()
    await expect(store.load()).resolves.toBeNull()
    expect(dexie.constructors).toBe(1)
    expect(dexie.stores).toHaveBeenCalledWith({ workspaces: 'id,updatedAt' })
    expect(dexie.get).toHaveBeenCalledWith('default')
  })

  it('returns stored data and fails safe when reads are unavailable', async () => {
    const workspace: TestWorkspace = {
      id: 'default',
      value: 'saved',
      updatedAt: '2026-07-13T00:00:00.000Z'
    }
    const store = createWorkspaceStore<TestWorkspace>('test-workspace')
    dexie.get.mockResolvedValueOnce(workspace).mockRejectedValueOnce(new Error('blocked'))

    await expect(store.load()).resolves.toEqual(workspace)
    await expect(store.load()).resolves.toBeNull()
  })

  it('writes the complete record and propagates write failures', async () => {
    const workspace: TestWorkspace = {
      id: 'default',
      value: 'saved',
      updatedAt: '2026-07-13T00:00:00.000Z'
    }
    const store = createWorkspaceStore<TestWorkspace>('test-workspace')
    dexie.put.mockResolvedValueOnce('default').mockRejectedValueOnce(new Error('quota'))

    await expect(store.save(workspace)).resolves.toBeUndefined()
    expect(dexie.put).toHaveBeenCalledWith(workspace)
    await expect(store.save(workspace)).rejects.toThrow('quota')
  })
})
