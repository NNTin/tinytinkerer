# Pixel Agents e2e coverage

Pixel Agents is a **passive visualization**: it projects a live TinyTinkerer chat run onto an
animated office rendered by a pinned, third-party browser bundle running inside a sandboxed
(`allow-scripts`, opaque-origin) iframe. It emits no chat events of its own, drives no tools, and
has no chat surface — see `docs/app-shell.md`'s "Pixel Agents distribution bridge" section for the
build-time pin/bridge architecture this doc assumes. This file is about the three tests, across
`tests/pixel-agents.e2e.ts` and `tests/pixel-agents-activity.e2e.ts`, that prove the visualization
actually tracks a real run — and how they use `fixtures/mock-litellm.ts` and
`fixtures/pixel-agents.ts`.

## What the suite proves, layer by layer

Each layer below is a real seam a bug can hide in; the suite has to cross all of them to mean
anything, because a passing assertion at any single layer can be vacuous (e.g. "the overlay shows
non-idle text" proves nothing if the run never actually started).

1. **Chat run** — a real chat turn through the real edge Hono worker (`fixtures/mock-litellm.ts`'s
   `pipeToEdge`), the real agent runtime (`packages/app/agent-core/src/runtime/agent-runtime-base.ts`),
   and the real tool registry. Only the LiteLLM upstream is mocked (replay or synthetic — see
   below).
2. **Chat events** — the runtime's `ChatEvent` stream (`agent.run.started`, `agent.step.*`,
   `agent.tool.*`, `agent.run.completed`) lands in the shared chat store
   (`@tinytinkerer/app-browser`'s `useChatStore`).
3. **`useLiveChatActivity` seeding** — `packages/app/app-shell/src/live-chat-activity.ts`. A
   generic hook any passive stage can enable once it's ready to receive activity; it seeds a
   "seen" event-id set on enable so restored history is never replayed as fresh activity, then
   delivers only the unseen tail as new events arrive.
4. **`messagesForChatEvent`** — `packages/app/pixel-agents/src/activity.ts`. Maps each `ChatEvent`
   to zero or more `PixelServerMessage`s: `agent.run.started`/`completed` become `agentStatus`
   (`active`/`waiting`); `agent.step.started` becomes `agentToolStart` with `toolId: step:<stepId>`
   and a `toolName` from `stepToolName` (`plan`/`think`/`observe`/`replan` → `'Read'`, everything
   else, including `act` and `synthesize`, → `'Write'`); `agent.tool.started` becomes
   `agentToolStart` with `toolId: <stepId>:<toolId>` and a `toolName` from `pixelToolName` (a
   read/search/list/... name pattern → `'Read'`, a shell/bash/exec pattern → `'Bash'`, everything
   else — including `run_javascript` — → `'Write'`).
5. **Bridge protocol messages** — `packages/app/pixel-agents/src/pixel-agents-stage.tsx` posts each
   `PixelServerMessage` to the sandboxed iframe over `postMessage` on the channel
   `PIXEL_AGENTS_BRIDGE_CHANNEL` (`packages/app/pixel-agents/src/protocol.ts`), envelope
   `{ channel, direction: 'server', message }`.
6. **Sandboxed office iframe** — the pinned upstream bundle (`docs/app-shell.md`), receiving the
   protocol messages via the injected bridge shim (`scripts/pixel-agents-bridge.mjs`) and rendering
   them onto its own canvas engine.
7. **Upstream test hooks** — `window.__pixelAgentsTestHooks` (gated on `window.__PIXEL_AGENTS_E2E`,
   set via `enablePixelHooks` in `fixtures/pixel-agents.ts`), exposing `getCharacters`,
   `messageLog` (scalar fields only — `type`/`status`/`toolId`/`toolName`/`at`, upstream's own
   `Date.now()`), and `selectAgent`.
8. **DOM activity overlay** — upstream's own e2e technique
   (`data-testid="agent-overlay"` + `data-agent-id`), read via `agentOverlayLocator`.
9. **Injected animation probe** — `scripts/pixel-agents-animation-probe.mjs`, a classic script
   injected right before upstream's module entry. A complete no-op unless
   `window.__PIXEL_AGENTS_E2E` is true at install time (checked once, at script-load, so production
   pays zero cost). When active it wraps `CanvasRenderingContext2D.prototype.drawImage`/`.fillRect`
   to record every office canvas draw into a bounded ring buffer, keyed by a stable per-object
   sprite/canvas identity (a `WeakMap<object, id>` — see "Animation-assertion machinery" below).
10. **Visual animation assertions** — `fixtures/pixel-agents.ts`'s `calibrateCharacterSlot` /
    `characterSpriteIdsInWindow`, asserting the character's sprite identity actually _changed_ in
    response to activity — not just that protocol messages arrived.

Layers 1–4 are TinyTinkerer's own code and unit-testable; layers 5–10 are the reason this needs a
real browser: nothing about postMessage delivery into a sandboxed iframe, the upstream bundle's
own rendering, or real canvas draw calls exists in jsdom.

## The three specs and their LiteLLM mock modes

`fixtures/mock-litellm.ts` documents the general mock architecture (see also
`.agent/skills/e2e-testing/SKILL.md`); this section is specifically about which mode each Pixel
Agents spec uses and why.

### `tests/pixel-agents.e2e.ts` — replay (capture-grounded live run)

Uses `installReplayMock(page, loadCapture('pixel-agents-live-run'))`. The fixture
(`fixtures/captures/pixel-agents-live-run.json`) was captured **on `/pixel-agents/`** — the SOP
rule (`.agent/skills/e2e-testing/workflows/create-e2e-test.md`) is that a capture and its replay
must recreate the exact same shell, Settings toggles, and prompt, or the replay mock's drift check
fails loudly. The scenario
(`fixtures/captures/scenarios/pixel-agents-live-run.json`) enables the code-exec plugin's Settings
toggle (`Code execution (run_javascript tool)`) and sends one prompt engineered to strongly bias a
single `run_javascript` tool call followed by synthesis: _"Use the run_javascript tool to add 2 and
3, then tell me the result and briefly explain how you computed it."_ The captured run is real
inference — a genuine `run_javascript` tool call, a real sandboxed execution, and real prose — so
this is the strongest fixture available: the office visualizes an _actual_ tool event, not an
invented one. The spec replays the scenario's exact prompt (via `loadScenario`, never retyped),
asserts the model context folded back a real sandbox result (`toolResultFor(mock,
'run_javascript')`), asserts the office's `messageLog` recorded a real `agentToolStart` whose
`toolId` ends in `:run_javascript` and whose `toolName` is `'Write'`, and asserts
`mock.replayError()` stays `undefined` after settle (the drift check never tripped).

### `tests/pixel-agents-activity.e2e.ts` phase 1/2 — replay, on `/canvas/`

The first test's phases 1–2 replay `canvas-thumbnail-empty` (captured on `/canvas/`) through
`fixtures/canvas-chat.ts`'s `openCanvasWithChat`, then navigate to `/pixel-agents/` on the **same
page** to prove the restored conversation renders as transcript history while the office stays
quiet (the seeding boundary — see below).

### `tests/pixel-agents-activity.e2e.ts` phase 3, and the second test — synthetic `installChatMock`

Phase 3 (the live half of test 1) and test 2 (office-layout restore) both use the synthetic
no-tool mock (`installChatMock`), deliberately **not** a capture replay. This is a drift-check
constraint, not a shortcut: the replay mock matches a captured exchange against the _current_
request's folded-back tool-result count at the same cursor position (`mockChatCompletionReplay` in
`fixtures/mock-litellm.ts`), but by the time phase 3 starts, phase 1's restored conversation has
already folded its own (canvas) tool results back into context — a fresh capture's exchange #0
expects `toolResultCount: 0` and would drift-fail immediately against a request that is really
exchange #0 of a _new_ turn appended after existing history. There is no way to satisfy the drift
check mid-conversation without hand-tailoring a fixture to that exact history shape, which is not
worth it: phase 3 only needs a plain liveness signal ("something animates"), which the synthetic
mock provides for free. Capture-grounded live coverage — a real tool call driving the office — is
therefore concentrated entirely in `tests/pixel-agents.e2e.ts`, which starts a single fresh
conversation with no restored history.

### History vs. live: the shared conversation DB and the persistence-race lesson

Every shell on the composed origin shares one `'tinytinkerer'` IndexedDB (the same database
`chat-persistence.e2e.ts` covers for web/widget/mobile — see `packages/e2e/README.md`); the most
recently updated conversation is restored on boot regardless of which shell loads it. This is
exactly what lets `pixel-agents-activity.e2e.ts` prove the seeding boundary: replay a real run on
`/canvas/`, then navigate to `/pixel-agents/` and confirm the restored conversation's real
`agent.tool.*`/`agent.run.started` events render as transcript text but produce **zero**
`agentToolStart`/`agentStatus: active` entries in the office — `useLiveChatActivity`'s seeding
(seen-set built from history before enabling) suppressed all of it.

The flake lesson worth repeating: "the final answer is visible" is a **live-store** signal, not a
**persistence** signal. Chat events are appended to IndexedDB asynchronously, so navigating away
right after the answer renders can unload the document while the run's tail writes (the final
answer event, `agent.run.completed`) are still in flight — the conversation restored on
`/pixel-agents/` would then be missing exactly the events phase 2 asserts on. The fix is
`persistedRunComplete` in `pixel-agents-activity.e2e.ts`: poll the _same_ shared database the
cross-shell restore reads, for both an `agent.run.completed` event and the final answer text, and
gate the `page.goto` on that — never a fixed sleep.

## Capturing a new `/pixel-agents/` fixture

Full SOP: `.agent/skills/e2e-testing/SKILL.md` +
`.agent/skills/e2e-testing/workflows/create-e2e-test.md`. Summary specific to this shell:

1. Write a scenario JSON under `fixtures/captures/scenarios/<name>.json`:
   `{ "name", "shell": "/pixel-agents/", "settings": [...], "steps": [{ "prompt": "..." }] }`.
   The capture tool's own doc comment (`.agent/skills/e2e-testing/tools/capture-llm-stream.mjs
--help`) lists only `/canvas/`, `/web/`, `/mobile/`, `/widget/` as the shell enum — that's stale
   documentation, not an enforced allow-list: the tool navigates
   `` `${baseUrl}${scenario.shell}` `` generically, so `/pixel-agents/` (or any other routed shell)
   works unchanged. Its canvas-specific "wait for `data-app-frame-status=ready`" branch simply
   doesn't fire for a non-`/canvas/` shell.
2. Run the tool: `node .agent/skills/e2e-testing/tools/capture-llm-stream.mjs --scenario
fixtures/captures/scenarios/<name>.json --target pr --out fixtures/captures/<name>.json`.
   Be patient — the live preview really rate-limits (429 + ~60s backoff), and the tool waits
   through it; don't kill and retry in a loop.
3. Eyeball the fixture: one successful exchange per model turn, sensible request digests
   (`meta`/`request` fields only — never headers/cookies/keys), and — for a tool-bearing scenario
   — an exchange whose SSE carries a real `tool_calls` delta for the tool under test.
4. If the final synthesis line needs to anchor `finalAnswerFragment` (a 20-character minimum-line
   filter — see `fixtures/mock-litellm.ts`), phrase the prompt to elicit more than a one-line
   answer; a terse prompt like "add 2 and 3, tell me the result" alone produced a captured answer
   too short (17 chars) for the filter to find a fragment, and had to be reworded to ask for a
   brief explanation too.
5. Rewire/write the spec with `installReplayMock` + `loadCapture`/`loadScenario` — never retype the
   captured prompt.

## Animation-assertion machinery

The probe (`scripts/pixel-agents-animation-probe.mjs`) gives ground truth on what actually
rendered; everything else (protocol messages, `messageLog`) only proves what was _sent_, not what
the office _did_ with it. Two tiers of assertion (T1/T2 in the specs' comments):

- **T1 — DOM overlay**: `agentOverlayLocator` polls the selected agent's overlay text for the
  `'Idle'` substring (present before/after a run, absent during). Deliberately checks for the
  substring rather than exact text (the panel also renders the folder name and a "×" close
  button while selected) and deliberately does not pin the specific activity word (`'think'` /
  `'act'` / `'synthesize'`, via `humanize(stepKind)`) so cosmetic step-label wording changes don't
  break the spec.

- **T2 — canvas identity**: `characterSpriteIdsInWindow` reads the probe's draw log and returns the
  set of distinct sprite _identities_ (`sourceId`, a stable per-object id from a `WeakMap` cache —
  see below) drawn at the calibrated character slot within a time window. A changing identity set
  across a before/after split is the ground-truth signal that the character's animation state
  changed, independent of whether the protocol delivered anything.
  - **`selectAgent` over a canvas click**: `selectPersistentAgent` calls the upstream test hook
    directly rather than clicking, because a click (or programmatic pan) can trigger a
    camera-follow lerp that moves the character on screen mid-calibration — `calibrateCharacterSlot`
    depends on the selected character's `dx` staying constant frame-to-frame.

  - **`calibrateCharacterSlot`'s pairing, not hard-coded geometry**: character sprites and small
    pet sprites are _both_ 16×32 (`CHAR_FRAME_W/H` / `PET_FRAME_W_SMALL/PET_FRAME_H` in the
    upstream bundle), and editor tile-swatch canvases also call `drawImage` — so no fixed sprite
    size or draw count can uniquely identify "the selected character's own draw." Instead,
    calibration exploits a structural relationship the renderer always produces for a _selected_
    character: a selection-outline draw immediately precedes the character draw, on the same
    canvas, in the same frame, offset by `-k` in both `dx`/`dy` and `2*k` larger in both `sw`/`sh`
    (`k` = the zoom-derived outline offset). Finding that pair in the draw log — rather than
    assuming any fixed geometry — self-verifies at runtime: if upstream ever changes the
    outline/selection rendering at the pinned commit, `calibrateCharacterSlot` throws a descriptive
    error pointing at the renderer/spriteCache files, instead of a later assertion silently seeing
    zero identity changes.

  - **The `dy`-shift lesson**: only `dx` (plus `sw`/`sh`) is pinned into the calibrated slot — not
    `dy`. A live run was observed (empirically, running this spec) to briefly toggle the seated
    character out of its typing state and back, which removes/re-adds a fixed "sitting offset"
    from `dy`. Pinning `dy` at calibration time would have made the suite misclassify exactly the
    frames it exists to detect as "not the character." `characterSpriteIdsInWindow` instead
    re-derives the outline pairing independently for every frame in its window, using the
    calibrated `outlineOffset` rather than a fixed `dy`.

  - **Sprite identity model**: the probe assigns each distinct sprite-cache object (a `WeakMap`
    keyed by the _cached canvas_ object, per (state, direction, frame, palette, hueShift) — see
    upstream's `spriteCache.ts`) a small stable integer id the first time it's seen, and reuses that
    id every time the same object is drawn again. The _same_ cached object is reused across frames
    whenever the animation state is unchanged, and a _different_ object appears the instant it
    changes — so "did the sprite change" reduces to a simple id-set comparison, never a pixel read.

  - **What T1/T2 actually assert** (`tests/pixel-agents.e2e.ts`): T1 checks the overlay goes
    non-idle during the run and back to idle after. T2(a) is a liveness check (`drawImageCalls`
    strictly increases — a frozen canvas would otherwise pass every identity-based assertion
    vacuously). T2(b) checks the run produced at least 2 distinct sprite identities overall. T2(c)
    splits the draw log at a specific `messageLog` timestamp and asserts the identity set on one
    side differs from the other — proving the character's sprite actually transitioned mid-run, not
    merely that some frames differ from others by coincidence. The split point is the _last_
    `'Write'`-classified `messageLog` entry (the synthesize step), not the first: a tool-bearing
    run emits several `'Write'` entries and the earliest lands too close to run start for the
    sprite to have visibly transitioned yet (found empirically at `--repeat-each=20`; the spec's
    own comment above `writeStarts` records the details).

  - **Transient-overlay caveat**: T1 samples the overlay's text via `expect.poll()`, which polls at
    an interval rather than observing every DOM mutation — a state that appears and disappears
    between two polls could be missed. This hasn't been observed as a real flake source (the
    non-idle window during a run is comfortably longer than the poll interval), but if it ever
    becomes one, the fix would mirror the animation probe's own approach: attach a
    `MutationObserver` to the overlay node before the run starts and record every text mutation
    into a log, rather than sampling a snapshot — the same "ground truth over polling" shift that
    already motivated the animation probe over relying on protocol messages alone.

## Pin-bump interplay

`scripts/check-pixel-agents-conformance.mjs` runs during `prepare-pixel-agents.mjs` and fails the
_build_ (not just this suite) if the built webview bundle drops any string literal or pattern this
integration hard-codes about upstream internals — see `docs/app-shell.md`'s "Bumping the pin"
section for the full pin-bump procedure. The literals it protects that this suite specifically
depends on:

- `'selectAgent'`, `'__pixelAgentsTestHooks'`, `'__PIXEL_AGENTS_E2E'` — without these,
  `selectPersistentAgent`/`characterIds`/`readMessageLog` all go silently inert (no thrown error;
  `selectAgent` becomes a no-op, so no selection outline is ever drawn and
  `calibrateCharacterSlot` times out with nothing pointing at the real cause).
- `'agent-overlay'`, `'data-agent-id'` — `agentOverlayLocator`'s selector; without them T1 never
  finds the overlay element.
- `'agentToolStart'`, `'agentToolDone'`, `'agentToolsClear'`, `'agentStatus'`, `'layoutLoaded'` —
  the protocol message type strings `messagesForChatEvent` emits and this suite's `messageLog`
  assertions filter on.

What breaks **loudly**: a conformance-gate literal going missing fails `pnpm prepare:pixel-agents`
(and therefore any build) with an explicit list of missing strings/patterns, before this suite ever
runs.

What the specs **self-diagnose**: `calibrateCharacterSlot` throws a descriptive error (naming
`renderer.ts`/`spriteCache.ts`) if the outline/character draw-pair structure it depends on ever
stops appearing — this is a _rendering_ assumption the conformance gate has no way to check
(it only greps the built bundle's source text, not runtime drawing behavior), so this is the one
failure mode that's caught here rather than at the pin-bump gate.

What breaks **silently otherwise**: nothing else in this suite has a dedicated guard — a change to
`agent-runtime-base.ts`'s step `kind`s (`plan`/`think`/`act`/`observe`/`replan`/`synthesize`) or to
`pixelToolName`'s classification patterns wouldn't fail any conformance gate; it would only show up
as `tests/pixel-agents.e2e.ts`'s explicit "expected both a Read and a Write entry" error (see the
spec's own comment above the check), which is why that check throws a message naming both source
files instead of just asserting a boolean.
