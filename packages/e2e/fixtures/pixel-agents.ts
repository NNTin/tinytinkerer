import { expect, type Frame, type Page } from '@playwright/test'
import { requireShellPort } from './first-load'

// Shared Pixel Agents e2e wiring, used by tests/pixel-agents.e2e.ts,
// tests/pixel-agents-activity.e2e.ts, and tests/pixel-agents-multi-agent.e2e.ts.
// The office is a vendored third-party bundle inside a sandboxed iframe:
// everything a spec can observe goes through
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
// specific step. `id` is the AGENT number a per-agent message (agentStatus,
// agentToolStart/Done/sClear, agentCreated/Closed/Selected) targets (issue
// #430: one agent per conversation) — absent on the agent-agnostic bootstrap
// messages (providerCapabilities, characterSpritesLoaded, …). `selectAgent`
// sets officeState.selectedAgentId directly — see selectPersistentAgent below
// for why the e2e suite drives selection through this hook rather than a
// canvas click.
export type PixelTestHooks = {
  getCharacters?: () => Array<{ id: number }>
  messageLog?: Array<{
    at: number
    type: string
    id?: number
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

// =============================================================================
// Multi-agent office interaction (issue #430 PR 5): launchAgent/focusAgent/
// closeAgent client messages, and non-pixel-hunting ways to trigger them from
// inside the sandboxed office iframe. See tests/pixel-agents-multi-agent.e2e.ts
// for which mechanism each interaction uses and why.
//
// scripts/pixel-agents-bridge.mjs's `installIntegrationStyle` hides upstream's
// Settings button (host-owned concern). "Close agent" was hidden too until
// issue #430 made each character one conversation — it is now a real,
// user-clickable control whose select-then-close two-step is the deliberate-
// interaction guard for deleting that conversation.
// =============================================================================

// Mirrors PIXEL_AGENTS_BRIDGE_CHANNEL (packages/app/pixel-agents/src/protocol.ts).
// Inlined (not imported) for the same reason pixel-agents-activity.e2e.ts inlines
// it: a value used inside a `frame.evaluate`/`addInitScript` callback is
// serialized into the page and cannot close over an import.
const BRIDGE_CHANNEL = 'tinytinkerer:pixel-agents:v1'

// Dispatches a PixelClientMessage AS IF the upstream webview sent it: posted
// from WITHIN the sandboxed iframe's own document (via `frame.evaluate`, never
// `page.evaluate`) so `event.source` on the host's listener really is
// `frameRef.current.contentWindow` and `event.origin` really is the sandboxed
// frame's opaque `'null'` (see pixel-agents-stage.tsx's message handler) — a
// top-level `page.evaluate` post could satisfy neither check.
//
// Upstream's own "+ Agent" toolbar button (addAgentButton below) IS reachable
// by a real click in this embedding (scripts/pixel-agents-bridge.mjs shims
// `window.acquireVsCodeApi`), so this helper isn't needed just to trigger
// `launchAgent` anymore. It stays useful for exercising message shapes no
// real UI control in this embedding can produce — e.g. `launchAgent` with its
// VS-Code-only `folderPath`/`bypassPermissions` fields set (the dropdown that
// would set them is source-patched out; see pixel-agents-multi-agent.e2e.ts).
export const dispatchPixelClientMessage = (
  frame: Frame,
  message: Record<string, unknown>
): Promise<void> =>
  frame.evaluate(
    (args) => {
      window.parent.postMessage(
        { channel: args.channel, direction: 'client', payload: JSON.stringify(args.message) },
        '*'
      )
    },
    { channel: BRIDGE_CHANNEL, message }
  )

// Investigated and ruled out as unnecessary: upstream's own e2e testing
// accommodation — its in-app "What's new" changelog (Settings → the version
// footer) literally lists a "Testing" section reading "Playwright e2e tests
// with mock Claude CLI" — is a "Debug View" toggle in Settings that swaps the
// whole canvas for a plain DOM list of every agent, each row a real click
// sending `focusAgent`, no canvas coordinates involved. It works (confirmed
// while building this file), but turned out redundant: a real click on the
// character itself (clickCharacterToSelect below) ALSO sends `focusAgent`, so
// there is no case here that needs the extra "open Settings, which needs its
// own raw-click workaround (see this file's module comment), enable Debug
// View, remember to leave it again" ceremony just to reach the same message.
// Kept as a note (not code) in case a future spec needs it: reach the toggle
// via `officeFrame.getByRole('button', { name: 'Debug View' })` after a raw
// `.click()` on the Settings button, then `getByText('Agent #<n>', { exact:
// true })` for a row.

// Real click-to-select on the CANVAS itself: clicks the office at the live
// position of `agentId`'s DOM overlay (the floating nameplate upstream renders
// above each character, `pointer-events: none` while unselected so the click
// passes through to the canvas beneath) offset down by the nameplate's own
// height + a small margin — empirically the character's own hit-box starts
// right where its nameplate ends. Re-reads the overlay's position fresh every
// call (never a hardcoded pixel), so this tracks whatever camera/zoom/layout
// state the office is currently in.
//
// This is a REAL click on the SAME code path a mouse click on a character
// always was: it both sets `officeState.selectedAgentId` (what makes the
// overlay's own "Close agent" button, pointer-events: none -> auto, appear —
// see clickAgentOverlayCloseButton) AND sends `focusAgent` to the host
// (verified empirically — clicking an agent moves the assistant panel to its
// conversation), unconditionally on EITHER a select or a deselect. That last
// part matters: clicking an ALREADY-selected agent's hit-box TOGGLES it off
// (still sending `focusAgent` for it) rather than staying selected, so this
// throws up front rather than polling forever for a selection that will never
// (re-)arrive if `agentId` is already the selected character.
//
// Throws a descriptive error instead of silently no-op'ing if the expected
// overlay never appears selected, so a future vendored-bundle change fails
// loudly here rather than as a confusing downstream timeout.
export const clickCharacterToSelect = async (
  page: Page,
  frame: Frame,
  agentId: number
): Promise<void> => {
  const alreadySelected = await frame.evaluate(
    (id) =>
      document.querySelector<HTMLElement>(`[data-testid="agent-overlay"][data-agent-id="${id}"]`)
        ?.style.pointerEvents === 'auto',
    agentId
  )
  if (alreadySelected) {
    throw new Error(
      `clickCharacterToSelect: agent ${agentId} is already selected — clicking it again would ` +
        'TOGGLE it off (upstream deselects an already-selected character on click), not keep it selected.'
    )
  }
  const canvasLoc = page
    .frameLocator('iframe[title="Pixel Agents office"]')
    .locator('canvas')
    .first()
  const overlayPointerEvents = (): Promise<string | undefined> =>
    frame.evaluate(
      (id) =>
        document.querySelector<HTMLElement>(`[data-testid="agent-overlay"][data-agent-id="${id}"]`)
          ?.style.pointerEvents,
      agentId
    )

  // Selecting a character can itself start a camera-follow pan (upstream sets
  // `cameraFollowId` on select), which moves every OTHER character's overlay —
  // including one this same call is about to click next, or was in the middle
  // of moving when THIS call started (e.g. right after another agent was just
  // created/selected). A single-shot click computed from a position read a
  // moment earlier can therefore land on stale coordinates; retries re-read
  // the overlay's position fresh each time, and skip a click entirely (no
  // wasted attempt) while the computed point is off-canvas — mid-pan is the
  // one time that can happen, since a settled camera always keeps every seated
  // character within the visible office.
  //
  // 20 attempts (raised from 12, alongside the click's own 1.5s timeout below):
  // empirically, a still-settling camera can occasionally keep the target
  // off-canvas for longer than 12 * 250ms (~3s) — observed causing this loop
  // to exhaust and throw well before the test's own 60s timeout, on a run
  // where the camera just hadn't settled yet. Worst case (every attempt both
  // finds a point and has that click intercepted) is 20 * (1_500 + 250) =
  // ~35s, still comfortably inside the test timeout alongside everything else
  // a caller does before/after this call.
  for (let attempt = 0; attempt < 20; attempt++) {
    const rect = await frame.evaluate((id) => {
      const overlay = document.querySelector(`[data-testid="agent-overlay"][data-agent-id="${id}"]`)
      const canvas = document.querySelector('canvas')
      if (!overlay || !canvas) return null
      const o = overlay.getBoundingClientRect()
      const c = canvas.getBoundingClientRect()
      const x = o.x + o.width / 2 - c.x
      const y = o.y - c.y + o.height + 4
      return { x, y, canvasWidth: c.width, canvasHeight: c.height }
    }, agentId)
    if (!rect) {
      throw new Error(
        `clickCharacterToSelect: no overlay/canvas found for agent ${agentId} — it may not exist yet.`
      )
    }
    const onCanvas =
      rect.x >= 0 && rect.x <= rect.canvasWidth && rect.y >= 0 && rect.y <= rect.canvasHeight
    if (onCanvas) {
      // A short, explicit timeout here matters: with none, a single click()
      // call inherits the whole TEST's timeout budget for its own internal
      // actionability retries. If the computed point keeps landing on the
      // still-settling overlay itself (its own nameplate can intercept the
      // click meant to land just below it while a camera pan is still in
      // progress — confirmed empirically via a captured "<span>Idle</span> ...
      // subtree intercepts pointer events" trace that burned the full 60s test
      // timeout on ONE stale position), that single call would keep retrying
      // against the SAME stale coordinates for the entire test budget instead
      // of returning control to this loop, which re-reads a fresh position
      // every attempt. Failing fast here and letting the loop's up-to-20
      // attempts each get a freshly-recomputed point is what actually makes
      // the retry loop robust to a still-animating camera.
      const clicked = await canvasLoc
        .click({ position: { x: rect.x, y: rect.y }, timeout: 1_500 })
        .then(() => true)
        .catch(() => false)
      const selectedOnce =
        clicked &&
        (await overlayPointerEvents()
          .then((value) => value === 'auto')
          .catch(() => false))
      // A single truthy read is not enough: `officeState.selectedAgentId`'s
      // synchronous mutation and its DOM reflection (this pointer-events
      // style, and the "Close agent" button's own mount) can be caught
      // mid-flicker by one read taken right at the click, then read false
      // again a beat later — confirmed empirically as the cause of a 60s
      // "element was detached, retrying" hang on a caller that clicks the
      // overlay's "Close agent" button immediately after this returns.
      // Requiring the SAME truthy result on a second read, a few animation
      // frames later, closes that window before this function hands
      // "selected" back to a caller.
      if (selectedOnce) {
        await page.waitForTimeout(150)
        const selectedStill = await overlayPointerEvents()
          .then((value) => value === 'auto')
          .catch(() => false)
        if (selectedStill) return
      }
    }
    // Give a still-settling camera pan (or a selection flicker, see above) a
    // moment before the next attempt reads a (hopefully now-stable) position.
    await page.waitForTimeout(250)
  }

  throw new Error(
    `clickCharacterToSelect: agent ${agentId}'s overlay never became selected (pointer-events: ` +
      'auto) after several clicks at its freshly-recomputed hit-box. Either the office camera ' +
      'never settled, or upstream changed the nameplate/hit-box layout this offset assumes.'
  )
}

// The character overlay's own "Close agent" button, rendered (and, since issue
// #430, actually visible/clickable) only once `clickCharacterToSelect` (or
// equivalent) has made that agent the office's selected character.
export const agentOverlayCloseButton = (page: Page, agentId: number) =>
  agentOverlayLocator(page, agentId).getByTitle('Close agent')

// Clicks the ALREADY-selected character's "Close agent" button — bounded,
// self-healing retries rather than a single `.click()`, because a stray
// selection flicker (the same race `clickCharacterToSelect` above guards
// against with its own stability re-check) can still detach this button's
// DOM node between Playwright resolving the locator and completing the
// click, which Playwright's own built-in actionability retry does not
// recover from if the flicker recurs faster than it settles. On a detected
// detach, re-checks whether `agentId` is still selected and, if the flicker
// toggled it off, re-selects (mirroring clickCharacterToSelect's own
// click-to-select path) before the next attempt.
export const closeSelectedAgentOverlay = async (
  page: Page,
  frame: Frame,
  agentId: number
): Promise<void> => {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await agentOverlayCloseButton(page, agentId).click({ timeout: 10_000 })
      return
    } catch (error) {
      lastError = error
      const stillSelected = await frame.evaluate(
        (id) =>
          document.querySelector<HTMLElement>(
            `[data-testid="agent-overlay"][data-agent-id="${id}"]`
          )?.style.pointerEvents === 'auto',
        agentId
      )
      if (!stillSelected) await clickCharacterToSelect(page, frame, agentId)
    }
  }
  throw lastError
}

// Upstream's own "+ Agent" toolbar button (webview-ui/src/components/
// BottomToolbar.tsx), rendered INSIDE the sandboxed office iframe — not a
// TinyTinkerer-owned control, so (like agentOverlayLocator above) this is
// scoped through frameLocator rather than a bare page.getByRole. It only
// renders because scripts/pixel-agents-bridge.mjs shims
// `window.acquireVsCodeApi`, making upstream treat this embedding as a VS
// Code webview host.
export const addAgentButton = (page: Page) =>
  page.frameLocator('iframe[title="Pixel Agents office"]').getByRole('button', { name: '+ Agent' })
