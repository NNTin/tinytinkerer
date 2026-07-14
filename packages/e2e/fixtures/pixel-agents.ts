import { expect, type Frame, type Page } from '@playwright/test'
import { requireShellPort } from './first-load'

// Shared Pixel Agents e2e wiring, used by tests/pixel-agents.e2e.ts and
// tests/pixel-agents-activity.e2e.ts. The office is a vendored third-party
// bundle inside a sandboxed iframe: everything a spec can observe goes through
// the upstream document's test hooks (`window.__pixelAgentsTestHooks`, gated on
// `window.__PIXEL_AGENTS_E2E`) or the workspace's IndexedDB record, so the
// hook plumbing, frame lookup, and DB reader live here once. Deliberately
// dependency-free beyond first-load.ts (like that file, this sits below both
// the chat-mock and canvas fixture stacks so either kind of spec can import it
// without pulling in the edge worker).

// The Pixel Agents shell is mounted with the other applications on the
// composed host origin.
export const PIXEL_AGENTS_URL = `http://localhost:${requireShellPort('E2E_PORT')}/pixel-agents/`

// The subset of the upstream bundle's test-hook surface these specs read. The
// messageLog records only scalar fields of each incoming bridge message
// (type/status/toolId/…) — never rich payloads like a layout object. `at` is
// upstream's own Date.now() timestamp on each entry — the same epoch the
// animation probe's draw records use (see DrawRecord below), so a draw log can
// be sliced against a specific messageLog entry's time. `toolName` is upstream's
// classification of the tool driving an agentToolStart entry into
// 'Read' | 'Bash' | 'Write' (see packages/app/pixel-agents/src/activity.ts),
// which the animation assertions use to correlate a sprite-class change with a
// specific step. `selectAgent` sets officeState.selectedAgentId directly —
// see selectPersistentAgent below for why the e2e suite drives selection
// through this hook rather than a canvas click.
export type PixelTestHooks = {
  getCharacters?: () => Array<{ id: number }>
  messageLog?: Array<{
    at: number
    type: string
    status?: string
    toolId?: string
    toolName?: string
  }>
  selectAgent?: (id: number) => void
}

// One ring-buffer record written by scripts/pixel-agents-animation-probe.mjs's
// drawImage wrapper: every drawImage call inside the office iframe, normalized
// across drawImage's 3/5/9-argument overloads (a 3/5-arg call has no explicit
// source rectangle, so sx/sy are 0 and sw/sh come from the source image's own
// dimensions instead).
export type DrawRecord = {
  t: number
  canvasId: number
  sourceId: number
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

export type ProbeTotals = {
  drawImageCalls: number
  fillRectCalls: number
}

// Identifies the calibrated persistent agent's character draws across an
// entire run. `dx`/`sw`/`sh` pin the seat column and sprite size, which stay
// constant for as long as the character remains seated at this desk. `dy` is
// deliberately NOT pinned here (see calibrateCharacterSlot): a seated
// character's y position itself shifts by a fixed "sitting offset" whenever
// the office FSM's state briefly leaves TYPE (observed at runtime during a
// live run) — pinning `dy` would misclassify that as "not the character" at
// exactly the moments activity is changing it. `outlineOffset` is the render
// zoom level (dx/dy delta, and half the source-dimension delta, between a
// selection outline draw and the character draw it always immediately
// precedes — see spriteCache.ts's getOutlineSprite); unlike `dy` it stays
// constant across every frame and state, so it re-verifies "this draw is the
// selected character" frame-by-frame instead of only at calibration time.
export type CharacterSlot = {
  canvasId: number
  dx: number
  sw: number
  sh: number
  outlineOffset: number
}

type AnimationProbe = {
  drawLog: () => DrawRecord[]
  totals: () => ProbeTotals
  reset: () => void
}

// The upstream office hooks are gated on window.__PIXEL_AGENTS_E2E, set via
// addInitScript so it reaches EVERY document this page context boots — install
// it before ANY navigation (a spec may plant the flag while on a different
// shell so a later pixel-agents office iframe still gets the hooks).
export const enablePixelHooks = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    ;(window as unknown as { __PIXEL_AGENTS_E2E: boolean }).__PIXEL_AGENTS_E2E = true
  })
}

// Wait for the office to boot (its canvas rendering inside the sandboxed
// iframe) and return the upstream document's Frame for hook evaluation.
// Re-call after a navigation/reload: each boot is a new frame/document.
// `.first()` because the office renders MORE canvases once a tile palette is
// open (each swatch is a canvas button); the main stage canvas is always first.
export const waitForOfficeFrame = async (page: Page): Promise<Frame> => {
  await expect(
    page.frameLocator('iframe[title="Pixel Agents office"]').locator('canvas').first()
  ).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => page.frames().some((candidate) => candidate.url().includes('/upstream/index.html')))
    .toBe(true)
  const frame = page.frames().find((candidate) => candidate.url().includes('/upstream/index.html'))
  if (!frame) throw new Error('Pixel Agents iframe was not available')
  return frame
}

export const characterIds = (frame: Frame): Promise<number[]> =>
  frame.evaluate(
    () =>
      (window as unknown as { __pixelAgentsTestHooks?: PixelTestHooks }).__pixelAgentsTestHooks
        ?.getCharacters?.()
        .map((character) => character.id) ?? []
  )

export const readMessageLog = (frame: Frame): Promise<NonNullable<PixelTestHooks['messageLog']>> =>
  frame.evaluate(
    () =>
      (window as unknown as { __pixelAgentsTestHooks?: PixelTestHooks }).__pixelAgentsTestHooks
        ?.messageLog ?? []
  )

// Selection is the linchpin for the animation e2e assertions: calling the
// upstream hook directly — instead of a canvas click — sets the same
// officeState.selectedAgentId a click would, WITHOUT the camera-follow lerp a
// click (or programmatic pan) can trigger. calibrateCharacterSlot below
// depends on the selected character's dx/dy staying stable frame-to-frame;
// a recentering camera would move the target out from under it mid-test.
export const selectPersistentAgent = (frame: Frame, id = 1): Promise<void> =>
  frame.evaluate(
    (agentId) =>
      (
        window as unknown as { __pixelAgentsTestHooks?: PixelTestHooks }
      ).__pixelAgentsTestHooks?.selectAgent?.(agentId),
    id
  )

// Reads scripts/pixel-agents-animation-probe.mjs's exposed window global. The
// probe is inert unless window.__PIXEL_AGENTS_E2E is true (set by
// enablePixelHooks below), so absence of __ttAnimationProbe is treated the
// same as an empty/zeroed reading rather than throwing — callers that forget
// to enable hooks get an obviously-wrong empty result to debug, not a crash
// deep in frame.evaluate.
export const readAnimationDrawLog = (frame: Frame): Promise<DrawRecord[]> =>
  frame.evaluate(
    () =>
      (
        window as unknown as { __ttAnimationProbe?: AnimationProbe }
      ).__ttAnimationProbe?.drawLog() ?? []
  )

export const readAnimationTotals = (frame: Frame): Promise<ProbeTotals> =>
  frame.evaluate(
    () =>
      (
        window as unknown as { __ttAnimationProbe?: AnimationProbe }
      ).__ttAnimationProbe?.totals() ?? {
        drawImageCalls: 0,
        fillRectCalls: 0
      }
  )

// Clears the ring buffer and call counters but preserves sprite/canvas
// identity (see the probe's own reset() comment) — called after selecting the
// persistent agent and before sending a live message, so the subsequent draw
// log only contains frames from the run under test.
export const resetAnimationProbe = (frame: Frame): Promise<void> =>
  frame.evaluate(() => {
    ;(window as unknown as { __ttAnimationProbe?: AnimationProbe }).__ttAnimationProbe?.reset()
  })

// Character sprite draws carry no discriminating metadata of their own —
// to the probe, every sprite (the persistent agent, a pet, or an editor
// swatch canvas) is just "some canvas, drawn at some rectangle". But
// selecting the persistent agent (selectPersistentAgent above) makes the
// renderer draw a SECOND image immediately before the character every frame:
// a selection outline exactly 2*zoom pixels larger in each axis, offset by
// -zoom in both x and y (webview-ui/src/office/engine/renderer.ts's
// renderScene, using the 1px-larger-per-side getOutlineSprite from
// spriteCache.ts). That structural relationship — same canvas, same frame
// timestamp, one draw exactly `k` pixels down-right of the other with source
// dimensions differing by exactly `2k` in both axes — uniquely identifies the
// character's own draw call without ever hard-coding a sprite size.
// Hard-coding is deliberately avoided: character frames and small pet frames
// are BOTH 16x32 (core/src/assets/constants.ts's CHAR_FRAME_W/H and
// PET_FRAME_W_SMALL/PET_FRAME_H), so a size-based classifier could not tell
// them apart, and editor tile-swatch canvases also call drawImage. This makes
// the calibration self-verifying at runtime: if upstream ever changes the
// outline/selection rendering at this pin, this throws a descriptive error
// instead of a downstream assertion silently seeing zero sprite changes.
//
// Only `dx` (not `dy`) is pinned into the returned slot: a live run was
// observed (empirically, running this spec) to toggle the character briefly
// out of its seated TYPE state and back, which removes/re-adds a fixed
// "sitting offset" from `dy` — exactly the kind of activity this suite means
// to detect, so pinning `dy` here would misclassify those frames as "not the
// character". `outlineOffset` (the constant zoom-derived `k`) lets
// characterSpriteIdsInWindow re-verify the outline pairing per frame instead,
// which correctly follows the character through that `dy` shift.
export const calibrateCharacterSlot = async (frame: Frame): Promise<CharacterSlot> => {
  const log = await readAnimationDrawLog(frame)

  const byFrame = new Map<string, DrawRecord[]>()
  for (const record of log) {
    const key = `${record.canvasId}:${record.t}`
    const bucket = byFrame.get(key)
    if (bucket) bucket.push(record)
    else byFrame.set(key, [record])
  }

  for (const records of byFrame.values()) {
    for (const a of records) {
      for (const b of records) {
        if (a === b) continue
        const k = b.dx - a.dx
        if (k <= 0) continue
        if (b.dy - a.dy !== k) continue
        if (a.sw !== b.sw + 2 * k) continue
        if (a.sh !== b.sh + 2 * k) continue
        return { canvasId: b.canvasId, dx: b.dx, sw: b.sw, sh: b.sh, outlineOffset: k }
      }
    }
  }

  throw new Error(
    'calibrateCharacterSlot: no outline/character draw pair found in the animation probe log. ' +
      "This structurally identifies the selected persistent agent's character sprite among all " +
      'canvas draws (renderer.ts draws a 2*zoom-larger selection outline immediately before the ' +
      'character every frame it is selected). Either selectPersistentAgent() was not called/awaited ' +
      'before this point, or upstream changed the outline/selection rendering at this pin — review ' +
      'webview-ui/src/office/engine/renderer.ts and webview-ui/src/office/sprites/spriteCache.ts ' +
      'before bumping.'
  )
}

// Distinct sprite identities (see DrawRecord.sourceId) drawn at the calibrated
// character slot within [fromT, toT] — a change in this set is the ground-truth
// signal that the character's animation state actually changed (e.g.
// typing<->reading sprite class), independent of whether any protocol message
// was ever delivered. Re-derives the outline pairing independently for EVERY
// frame in the window (matching on `dx`/`sw`/`sh` plus a same-frame outline
// draw offset by the calibrated `outlineOffset`), rather than reusing a single
// fixed `dy` from calibration time — see calibrateCharacterSlot's comment for
// why `dy` alone cannot be trusted to stay constant.
export const characterSpriteIdsInWindow = (
  log: DrawRecord[],
  slot: CharacterSlot,
  fromT: number,
  toT: number
): Set<number> => {
  const byFrame = new Map<number, DrawRecord[]>()
  for (const record of log) {
    if (record.t < fromT || record.t > toT) continue
    if (record.canvasId !== slot.canvasId) continue
    const bucket = byFrame.get(record.t)
    if (bucket) bucket.push(record)
    else byFrame.set(record.t, [record])
  }

  const ids = new Set<number>()
  for (const records of byFrame.values()) {
    for (const record of records) {
      if (record.dx !== slot.dx || record.sw !== slot.sw || record.sh !== slot.sh) continue
      const k = slot.outlineOffset
      const hasOutlinePartner = records.some(
        (candidate) =>
          candidate.dx === record.dx - k &&
          candidate.dy === record.dy - k &&
          candidate.sw === record.sw + 2 * k &&
          candidate.sh === record.sh + 2 * k
      )
      if (hasOutlinePartner) ids.add(record.sourceId)
    }
  }
  return ids
}

// Mirrors upstream's own e2e technique (ToolOverlay.tsx's
// data-testid="agent-overlay" + data-agent-id): the DOM overlay is the one
// place upstream itself asserts activity, deliberately avoiding pixel-hunting
// (see its own e2e/pets.spec.ts). Scoped inside the office iframe, same as
// every other office locator in this file.
export const agentOverlayLocator = (page: Page, agentId: number) =>
  page
    .frameLocator('iframe[title="Pixel Agents office"]')
    .locator(`[data-testid="agent-overlay"][data-agent-id="${agentId}"]`)

// The saved office layout, read from the same IndexedDB record the workspace
// persists to (packages/app/pixel-agents/src/workspace-db.ts): database
// 'tinytinkerer-pixel-agents', store 'workspaces', id 'default'. The whole
// layout object — a restore assertion needs to compare it, not just version it.
export const savedOfficeLayout = (page: Page): Promise<Record<string, unknown> | null> =>
  page.evaluate(
    () =>
      new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const open = indexedDB.open('tinytinkerer-pixel-agents')
        open.onerror = () => reject(open.error ?? new Error('Could not open Pixel Agents database'))
        open.onsuccess = () => {
          const database = open.result
          const request = database
            .transaction('workspaces')
            .objectStore('workspaces')
            .get('default')
          request.onerror = () =>
            reject(request.error ?? new Error('Could not read Pixel Agents workspace'))
          request.onsuccess = () => {
            const value = request.result as { layout?: Record<string, unknown> } | undefined
            resolve(value?.layout ?? null)
            database.close()
          }
        }
      })
  )

// Just the saved layout's version (null when nothing is persisted yet or the
// record carries no numeric version) — the write-side spec's poll target.
export const savedOfficeLayoutVersion = async (page: Page): Promise<number | null> => {
  const layout = await savedOfficeLayout(page)
  return typeof layout?.version === 'number' ? layout.version : null
}
