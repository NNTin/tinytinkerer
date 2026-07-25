import { createWorkspaceStore, type WorkspaceStore } from '@tinytinkerer/app-shell'
import type { PixelAgentMeta } from './protocol'

const PIXEL_AGENTS_DATABASE_NAME = 'tinytinkerer-pixel-agents'

export type PixelAgentsWorkspaceRecord = {
  id: 'default'
  layout: Record<string, unknown> | null
  // Seat/palette appearance per agent NUMBER (issue #430: one agent per
  // conversation now, so this is keyed by the small monotonic int assigned
  // below rather than a single flat record).
  agentMeta: Record<number, PixelAgentMeta>
  // conversationId -> agent number, so a conversation's seat/appearance
  // survives reload and conversation-list reordering.
  agentNumbers: Record<string, number>
  // Next number `resolveAgentNumber` will hand out. Monotonic — numbers are
  // NEVER reused (see `retireAgentNumber`), so a stale seat/postMessage for a
  // deleted agent can never land on a later, unrelated conversation.
  nextAgentNumber: number
  updatedAt: string
}

// The shape persisted by pre-#430 (single-agent) Pixel Agents: one flat
// PixelAgentMeta and no conversation mapping at all — there was only ever one
// agent, hardcoded to id 1. Not exported on its own: test seams that need to
// exercise the legacy shape type against `StoredPixelAgentsWorkspaceRecord`
// below, which IS exported.
type LegacyPixelAgentsWorkspaceRecord = {
  id: 'default'
  layout: Record<string, unknown> | null
  agentMeta: PixelAgentMeta
  updatedAt: string
}

export type StoredPixelAgentsWorkspaceRecord =
  | PixelAgentsWorkspaceRecord
  | LegacyPixelAgentsWorkspaceRecord

// `nextAgentNumber` only exists on the current (multi-agent) shape, so its
// absence is an unambiguous, cheap marker for "this row predates #430" —
// no separate schema-version field was ever persisted for the legacy shape.
const isLegacyRecord = (
  record: StoredPixelAgentsWorkspaceRecord
): record is LegacyPixelAgentsWorkspaceRecord => !('nextAgentNumber' in record)

// Migrate a legacy single-agent record onto agent number 1: a pre-#430 user's
// one seated/paletted character keeps its exact seat and palette instead of
// the office reseating it as a brand-new agent. `agentNumbers` comes back
// empty — nothing has bound a conversation to agent 1 yet; the stage does
// that (see `adoptLegacySeat`) once it knows which conversation to adopt onto.
const migrateLegacyRecord = (
  legacy: LegacyPixelAgentsWorkspaceRecord
): PixelAgentsWorkspaceRecord => ({
  id: 'default',
  layout: legacy.layout,
  agentMeta: { 1: legacy.agentMeta },
  agentNumbers: {},
  nextAgentNumber: 2,
  updatedAt: legacy.updatedAt
})

// Exposed so a host that embeds the stage OUTSIDE the main product (e.g. the
// docs site's isolated live-lab session) can point it at a differently-named
// IndexedDB database, keeping its demo agents' seats/layout from colliding
// with the same-origin product's own `tinytinkerer-pixel-agents` database.
export const createPixelAgentsWorkspaceStore = (
  databaseName: string = PIXEL_AGENTS_DATABASE_NAME
): WorkspaceStore<StoredPixelAgentsWorkspaceRecord> =>
  createWorkspaceStore<StoredPixelAgentsWorkspaceRecord>(databaseName)

const pixelAgentsWorkspaceStore = createPixelAgentsWorkspaceStore()

// The result of loading the workspace record. `migratedFromLegacy` is the ONLY
// reliable signal that a pre-#430 record was just upgraded in memory (the
// legacy shape is consumed right here): callers must use it — not any
// property of `record` itself — to decide whether `adoptLegacySeat` may run.
// Without this, an empty `agentNumbers` plus meta for agent 1 looks identical
// whether it's a fresh migration or a modern record that simply had every
// conversation deleted while agent 1's stale seat/meta lingered (retirement
// drops the mapping entry but nothing forces `agentMeta` to empty in lockstep
// in every path), and adopting in the latter case would re-issue a retired
// number onto an unrelated conversation.
export type LoadedPixelAgentsWorkspace = {
  record: PixelAgentsWorkspaceRecord | null
  migratedFromLegacy: boolean
}

export const loadPixelAgentsWorkspace = async (
  store: WorkspaceStore<StoredPixelAgentsWorkspaceRecord> = pixelAgentsWorkspaceStore
): Promise<LoadedPixelAgentsWorkspace> => {
  const saved = await store.load()
  if (!saved) return { record: null, migratedFromLegacy: false }
  if (isLegacyRecord(saved)) {
    return { record: migrateLegacyRecord(saved), migratedFromLegacy: true }
  }
  return { record: saved, migratedFromLegacy: false }
}

export const savePixelAgentsWorkspace = (
  workspace: Pick<
    PixelAgentsWorkspaceRecord,
    'layout' | 'agentMeta' | 'agentNumbers' | 'nextAgentNumber'
  >,
  store: WorkspaceStore<StoredPixelAgentsWorkspaceRecord> = pixelAgentsWorkspaceStore
): Promise<void> => store.save({ id: 'default', ...workspace, updatedAt: new Date().toISOString() })

// ---------------------------------------------------------------------------
// Pure agent-number helpers (issue #430). Kept store/React-free so the stage's
// bootstrap and reconciliation logic — and these rules in isolation — are both
// unit-testable without a DOM or an iframe.
// ---------------------------------------------------------------------------

export type AgentNumberAssignment = {
  agentNumber: number
  agentNumbers: Record<string, number>
  nextAgentNumber: number
}

// Resolve `conversationId`'s agent number, assigning the next free one (and
// bumping the counter) when it has none yet. Returns the SAME `agentNumbers`
// object reference when nothing changed, so callers can cheaply detect a no-op
// assignment (e.g. to skip a redundant persist) with `!==`.
export const resolveAgentNumber = (
  agentNumbers: Record<string, number>,
  nextAgentNumber: number,
  conversationId: string
): AgentNumberAssignment => {
  const existing = agentNumbers[conversationId]
  if (existing !== undefined) {
    return { agentNumber: existing, agentNumbers, nextAgentNumber }
  }
  return {
    agentNumber: nextAgentNumber,
    agentNumbers: { ...agentNumbers, [conversationId]: nextAgentNumber },
    nextAgentNumber: nextAgentNumber + 1
  }
}

// Retire a deleted conversation's agent number: drop its mapping entry and its
// seat/palette. The number itself is never handed out again — `nextAgentNumber`
// only ever increases — so a late-arriving `saveAgentSeats` for the just-closed
// agent cannot mis-bind onto a conversation created afterwards.
export const retireAgentNumber = (
  agentNumbers: Record<string, number>,
  agentMeta: Record<number, PixelAgentMeta>,
  conversationId: string
): { agentNumbers: Record<string, number>; agentMeta: Record<number, PixelAgentMeta> } => {
  const agentNumber = agentNumbers[conversationId]
  if (agentNumber === undefined) {
    return { agentNumbers, agentMeta }
  }
  const nextAgentNumbers = { ...agentNumbers }
  delete nextAgentNumbers[conversationId]
  const nextAgentMeta = { ...agentMeta }
  delete nextAgentMeta[agentNumber]
  return { agentNumbers: nextAgentNumbers, agentMeta: nextAgentMeta }
}

// One-time adoption rule for a freshly migrated legacy record (issue #430
// decision #4 / plan section 5): right after migration, agent 1 has
// seat/palette meta but `agentNumbers` is empty — nothing has claimed it yet.
// Binds the OLDEST conversation to agent 1, so a pre-#430 user's single seated
// character keeps its exact seat/palette instead of the office reseating it as
// a fresh, unseated agent. "Oldest" is chosen (over "the active one") because
// it is unambiguous and reload-stable: `conversationIdsMostRecentFirst` is the
// store's own most-recent-first order, so the oldest conversation — almost
// certainly the one the single pre-#430 agent represented — is simply its
// last entry, with no dependency on which conversation happens to be active
// at the moment migration is observed.
//
// A no-op (returns `agentNumbers` unchanged) once any conversation has already
// been bound (this only ever fires once) or there is no conversation to adopt
// onto.
//
// CALLERS MUST GATE this on `loadPixelAgentsWorkspace`'s `migratedFromLegacy`
// flag, not merely on "agentNumbers is empty and agentMeta has key 1": a
// modern (post-#430) record can reach that same shape if every conversation
// gets deleted while a stale agent-1 seat lingers (retirement drops the
// `agentNumbers` mapping entry, not necessarily `agentMeta` in the same
// breath in every path) — calling this unconditionally would re-issue the
// retired number 1 onto whatever unrelated conversation is created next,
// violating the never-reuse invariant `retireAgentNumber` exists to uphold.
export const adoptLegacySeat = (
  agentNumbers: Record<string, number>,
  agentMeta: Record<number, PixelAgentMeta>,
  conversationIdsMostRecentFirst: readonly string[]
): Record<string, number> => {
  if (Object.keys(agentNumbers).length > 0) return agentNumbers
  if (!(1 in agentMeta)) return agentNumbers
  const oldestConversationId = conversationIdsMostRecentFirst.at(-1)
  if (!oldestConversationId) return agentNumbers
  return { ...agentNumbers, [oldestConversationId]: 1 }
}
