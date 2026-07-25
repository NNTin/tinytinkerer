import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceStore } from '@tinytinkerer/app-shell'
import {
  adoptLegacySeat,
  createPixelAgentsWorkspaceStore,
  loadPixelAgentsWorkspace,
  resolveAgentNumber,
  retireAgentNumber,
  savePixelAgentsWorkspace,
  type PixelAgentsWorkspaceRecord,
  type StoredPixelAgentsWorkspaceRecord
} from '../src/workspace-db'

describe('Pixel Agents workspace persistence', () => {
  it('persists the layout and per-agent-number appearance as one workspace', async () => {
    const save = vi.fn<(value: PixelAgentsWorkspaceRecord) => Promise<void>>().mockResolvedValue()
    const store: WorkspaceStore<PixelAgentsWorkspaceRecord> = {
      load: vi.fn().mockResolvedValue(null),
      save
    }

    await savePixelAgentsWorkspace(
      {
        layout: { version: 1 },
        agentMeta: { 1: { palette: 3, hueShift: 12, seatId: 'desk-1' } },
        agentNumbers: { 'conversation-a': 1 },
        nextAgentNumber: 2
      },
      store
    )

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'default',
        layout: { version: 1 },
        agentMeta: { 1: { palette: 3, hueShift: 12, seatId: 'desk-1' } },
        agentNumbers: { 'conversation-a': 1 },
        nextAgentNumber: 2
      })
    )
    await expect(loadPixelAgentsWorkspace(store)).resolves.toEqual({
      record: null,
      migratedFromLegacy: false
    })
  })

  it('migrates a legacy single-agent record onto agent number 1 and reports the migration', async () => {
    const store: WorkspaceStore<StoredPixelAgentsWorkspaceRecord> = {
      // The pre-#430 shape: a flat PixelAgentMeta and no `agentNumbers`/`nextAgentNumber`.
      load: vi.fn().mockResolvedValue({
        id: 'default',
        layout: { version: 1 },
        agentMeta: { palette: 3, hueShift: 12, seatId: 'desk-1' },
        updatedAt: '2026-01-01T00:00:00.000Z'
      }),
      save: vi.fn().mockResolvedValue(undefined)
    }

    const loaded = await loadPixelAgentsWorkspace(store)

    expect(loaded).toEqual({
      record: {
        id: 'default',
        layout: { version: 1 },
        agentMeta: { 1: { palette: 3, hueShift: 12, seatId: 'desk-1' } },
        agentNumbers: {},
        nextAgentNumber: 2,
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      migratedFromLegacy: true
    })
  })

  it('loads a current-shape record unchanged and reports no migration', async () => {
    const current: PixelAgentsWorkspaceRecord = {
      id: 'default',
      layout: null,
      agentMeta: { 1: { palette: 1 } },
      agentNumbers: { 'conversation-a': 1 },
      nextAgentNumber: 2,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const store: WorkspaceStore<PixelAgentsWorkspaceRecord> = {
      load: vi.fn().mockResolvedValue(current),
      save: vi.fn().mockResolvedValue(undefined)
    }

    await expect(loadPixelAgentsWorkspace(store)).resolves.toEqual({
      record: current,
      migratedFromLegacy: false
    })
  })

  it('reports no migration for a modern record even when agentNumbers is empty and agent 1 has stale meta (issue #430 invariant)', async () => {
    // Shape-only lookalike of a fresh migration: a post-#430 user who deleted
    // every conversation can end up here too (retirement drops the mapping
    // entry, not necessarily the meta, in every path). Only `migratedFromLegacy`
    // — not this shape — may gate `adoptLegacySeat`.
    const current: PixelAgentsWorkspaceRecord = {
      id: 'default',
      layout: null,
      agentMeta: { 1: { palette: 9 } },
      agentNumbers: {},
      nextAgentNumber: 4,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const store: WorkspaceStore<PixelAgentsWorkspaceRecord> = {
      load: vi.fn().mockResolvedValue(current),
      save: vi.fn().mockResolvedValue(undefined)
    }

    await expect(loadPixelAgentsWorkspace(store)).resolves.toEqual({
      record: current,
      migratedFromLegacy: false
    })
  })

  describe('resolveAgentNumber', () => {
    it('assigns the next number and advances the counter for an unseen conversation', () => {
      const result = resolveAgentNumber({}, 1, 'conversation-a')
      expect(result).toEqual({
        agentNumber: 1,
        agentNumbers: { 'conversation-a': 1 },
        nextAgentNumber: 2
      })
    })

    it('returns the existing number, unchanged, for an already-known conversation', () => {
      const agentNumbers = { 'conversation-a': 1 }
      const result = resolveAgentNumber(agentNumbers, 2, 'conversation-a')
      expect(result.agentNumber).toBe(1)
      expect(result.nextAgentNumber).toBe(2)
      // Same reference: callers rely on this to detect a no-op assignment.
      expect(result.agentNumbers).toBe(agentNumbers)
    })

    it('never reuses a number across successive assignments', () => {
      let agentNumbers: Record<string, number> = {}
      let nextAgentNumber = 1
      const first = resolveAgentNumber(agentNumbers, nextAgentNumber, 'a')
      agentNumbers = first.agentNumbers
      nextAgentNumber = first.nextAgentNumber
      const second = resolveAgentNumber(agentNumbers, nextAgentNumber, 'b')
      expect(first.agentNumber).toBe(1)
      expect(second.agentNumber).toBe(2)
      expect(second.nextAgentNumber).toBe(3)
    })
  })

  describe('retireAgentNumber', () => {
    it('drops the mapping entry and the seat for a known conversation', () => {
      const result = retireAgentNumber(
        { 'conversation-a': 1, 'conversation-b': 2 },
        { 1: { palette: 1 }, 2: { palette: 2 } },
        'conversation-a'
      )
      expect(result.agentNumbers).toEqual({ 'conversation-b': 2 })
      expect(result.agentMeta).toEqual({ 2: { palette: 2 } })
    })

    it('is a no-op for an unknown conversation id', () => {
      const agentNumbers = { 'conversation-b': 2 }
      const agentMeta = { 2: { palette: 2 } }
      const result = retireAgentNumber(agentNumbers, agentMeta, 'conversation-a')
      expect(result.agentNumbers).toBe(agentNumbers)
      expect(result.agentMeta).toBe(agentMeta)
    })

    it('a retired number is never reassigned by a later resolveAgentNumber call', () => {
      const retired = retireAgentNumber({ a: 1, b: 2 }, {}, 'a')
      const assignment = resolveAgentNumber(retired.agentNumbers, 3, 'c')
      expect(assignment.agentNumber).toBe(3)
    })
  })

  describe('adoptLegacySeat', () => {
    it('binds the oldest (last, in most-recent-first order) conversation to agent 1', () => {
      const result = adoptLegacySeat({}, { 1: { palette: 3 } }, [
        'newest-conversation',
        'middle-conversation',
        'oldest-conversation'
      ])
      expect(result).toEqual({ 'oldest-conversation': 1 })
    })

    it('is a no-op once any conversation is already mapped', () => {
      const agentNumbers = { 'conversation-a': 1 }
      const result = adoptLegacySeat(agentNumbers, { 1: { palette: 3 } }, ['conversation-b'])
      expect(result).toBe(agentNumbers)
    })

    it('is a no-op when there is no legacy agent-1 seat to adopt', () => {
      const agentNumbers = {}
      const result = adoptLegacySeat(agentNumbers, {}, ['conversation-a'])
      expect(result).toBe(agentNumbers)
    })

    it('is a no-op when there is no conversation to adopt onto', () => {
      const agentNumbers = {}
      const result = adoptLegacySeat(agentNumbers, { 1: { palette: 3 } }, [])
      expect(result).toBe(agentNumbers)
    })
  })

  describe('createPixelAgentsWorkspaceStore', () => {
    // Database creation is deferred until first use (see workspace-store.ts),
    // so constructing a store never touches IndexedDB — safe to assert on the
    // shape/identity here without a real IndexedDB implementation available.
    it('returns a load/save store for the default (product) database when called with no name', () => {
      const store = createPixelAgentsWorkspaceStore()
      expect(typeof store.load).toBe('function')
      expect(typeof store.save).toBe('function')
    })

    it('returns independent store instances for distinct database names (issue #452 isolation)', () => {
      const productStore = createPixelAgentsWorkspaceStore('tinytinkerer-pixel-agents')
      const docsStore = createPixelAgentsWorkspaceStore('tinytinkerer-docs-lab-pixel-agents')
      expect(productStore).not.toBe(docsStore)
    })
  })
})
