# Issue #430 — Multi-conversation support (one agent per conversation in Pixel Agents)

Status: **Phase 1 plan — awaiting human review.** No implementation yet.

Parent: #405. Requirement (issue + human): the Chat Assistant maintains multiple
conversations that can run in parallel; users can reset a conversation, start a new
one, and switch between them; each conversation appears as one agent in the Pixel
Agents office.

---

## 1. Where the single-conversation assumption lives today

All references are against `develop` @ `9aadb3d`.

### 1.1 Chat store (the singleton)

`packages/app/app-browser/src/stores/chat-store.ts`

- One `conversationId`, one `events` array, one `isRunning` flag in state
  (`chat-store.ts:15-19`).
- One closure-level `activeRunController` (`chat-store.ts:47`) and one `isSending`
  re-entry latch (`chat-store.ts:54`, issue #334). `sendPrompt` gates on
  `isSending || get().isRunning` (`chat-store.ts:136`) — **one run at a time,
  globally**.
- `resetConversation` aborts _the_ active run before clearing (`chat-store.ts:214-228`,
  issue #332) and clears the _entire_ inspector store (`chat-store.ts:227`).
- `stop`/`cancelRetry` share one abort path that also settles **every** open human
  prompt via `resetAllHumanPrompts()` (`chat-store.ts:59-65`).
- `onEvent` drops post-abort events and collapses live stream snapshots via
  `appendLiveChatEvent` into the single `events` array (`chat-store.ts:169-180`).

### 1.2 Core chat logic

`packages/app/app-core/src/chat.ts`

- `initializeChatState` = "load latest conversation or create one"
  (`chat.ts:55-74`, `chat.ts:231-234`). There is no notion of enumerating or
  choosing a conversation.
- `executeChatPrompt` is already conversation-scoped (takes `conversationId`,
  `existingEvents`, its own `signal`, `chat.ts:145-217`) — **it can run
  concurrently for different conversations today**; only the store above prevents it.
- Rate-limit cooldown is keyed per LiteLLM deployment in the shared preferences
  store (`chat.ts:21-26`), i.e. global across conversations. That is _correct_ for
  multi-conversation (a 429 is per credential/deployment, not per conversation).
- `canSendPrompt` mixes conversation state (isRunning) with global state
  (cooldown) (`chat.ts:116-117`).

### 1.3 Persistence — already multi-conversation shaped

`packages/app/app-browser/src/db.ts`, `packages/app/app-core/src/ports.ts`

- The Dexie schema **already has** a `conversations` table (`id, updatedAt`) and an
  `events` table indexed by `conversationId` (`db.ts:24-27`). `Conversation` has
  `id/title/createdAt/updatedAt` (`ports.ts:4-9`); every `PersistedEvent` carries
  `conversationId` (`ports.ts:11-13`).
- What's missing is purely API surface: `ConversationRepository`
  (`ports.ts:31-37`) has no `listConversations`, no `deleteConversation`, no
  title update. `getLatestConversation` (`db.ts:189-191`) is the only accessor.
- `clearConversationEvents` deletes events but keeps the conversation row
  (`db.ts:204-206`) — reset already preserves identity, which maps cleanly onto
  "reset keeps the agent's seat".
- **No schema version bump needed** for the core feature; migration path for
  existing users is trivial (their existing conversation(s) just appear in the list;
  users who reset a lot may have exactly one row).
- `packages/app/app-browser/src/shell.ts:123-139` mirrors the repository API and
  must grow the same methods.

### 1.4 Runtime & concurrency

- `createBrowserRuntimeFactory` (`runtime/get-runtime.ts:26-46`) creates a **fresh
  runtime per run** (`runPrompt` calls `runtimeFactory.create().run(...)`,
  `app-core/chat.ts:137-143`). Per-run mutable state (e.g. the DOM snapshot,
  `create-runtime.ts:198-199`) is therefore isolated already.
- Shared across runs: the plugin runtime (`createPluginRuntime`, one
  `PluginRegistry` instance held by the factory, `create-runtime.ts:57-80`,
  memoized in `chat-store.ts:92-119`). Plugin instances are shared; needs an audit
  per plugin for cross-run mutable state (browser-state, code-exec sandbox) —
  most tool state is instantiated per runtime, but lifecycle hooks observe
  activation "across runs" by design.
- **Human prompt bridge is a global singleton**
  (`app-browser/src/human-prompt-bridge.ts:26`): one module-level queue, one modal;
  `resetAllHumanPrompts` (`human-prompt-bridge.ts:58-63`) settles _all_ pending
  prompts. With N parallel runs, stopping/resetting conversation A would dismiss
  conversation B's permission prompt. Needs per-run/conversation scoping.
- Inspector store (`stores/inspector-store.ts`) is one global ring buffer
  (MAX 20); entries carry no conversation dimension; reset clears everything.
- Edge/LiteLLM: the edge inbound rate limit buckets **per credential**
  (`apps/edge/src/lib/inbound-rate-limit.ts:132-147`) and LiteLLM user keys carry
  per-user `rpmLimit`/`tpmLimit`/budget (`apps/edge/src/lib/litellm-user-keys.ts`).
  Parallel runs from one user share those budgets. A 429 in any run lands in the
  **shared** per-deployment cooldown (correct coordination point); in-flight runs
  keep their own retry loop.
- The auto-retry loop and cooldown writes in `applyRateLimitEvent`
  (`app-core/chat.ts:81-114`) are last-writer-wins across concurrent runs —
  acceptable (both writers observed a 429 from the same deployment) but worth a
  test.

### 1.5 Chat UI surfaces

- `useChatSurfaceController` (`app-browser/src/surfaces.tsx:76-220`) reads the
  singleton store; every surface (floating `chat-shell/floating-chat-surface.tsx:178-180`,
  docked `chat-shell/docked-chat-surface.tsx:314-316`) has a "Reset conversation"
  header button and nothing else conversation-related.
- `ChatApp` (`chat-shell/chat-app.tsx:61-64`) is explicitly "the single shared chat
  App: one session".
- Followers of "the one conversation": `conversation-empty-state.tsx`,
  `media-registry.ts:51-58` (subscribes to `stores.chat` events),
  `context-gauge.tsx` (context usage from the events), `hooks.ts:23`
  (cooldown — global, stays as is), `app-shell/src/assistant-action.ts:7-8`
  (stage → `sendPrompt` seam; must target a conversation once N exist).
- Turn reconciliation memoizes against one previous list
  (`surfaces.tsx:126-131`) — must be per conversation or reset on switch.

### 1.6 Pixel Agents projection

- `PIXEL_AGENT_ID = 1` hardcoded (`pixel-agents/src/protocol.ts:4`); bootstrap
  advertises exactly one agent (`protocol.ts:148-153`) and one folder name
  'TinyTinkerer' (`protocol.ts:151`).
- `messagesForChatEvent` (`activity.ts:24-77`) stamps every message with
  `PIXEL_AGENT_ID` — no conversation input at all.
- Seat persistence stores exactly one agent's meta, hard-reading `seats['1']`
  (`pixel-agents-stage.tsx:98-107`; `workspace-db.ts:6-11` holds a single
  `agentMeta`).
- The stage receives one `events`/`isRunning` pair (`stage-props.ts:4-8`;
  `apps/pixel-agents/src/pixel-agents-page.tsx:6-7`) and feeds one
  `useLiveChatActivity` instance (`pixel-agents-stage.tsx:162-175`). The hook
  itself (`app-shell/src/live-chat-activity.ts:45-96`) tracks one seen-set/one
  run boundary — per-conversation instances are needed (it is cheap; the hook can
  be instantiated N times or generalized).
- Our client-message whitelist accepts only `webviewReady | saveLayout |
saveAgentSeats` (`protocol.ts:59-70`).
- **Upstream capability check** (pinned commit `928ccd4`, verified in the actual
  upstream sources): the webview handles dynamic `agentCreated` (with
  `folderName`) and `agentClosed` server messages
  (`webview-ui/src/hooks/useExtensionMessages.ts:186`, `:216`), and _sends_
  `launchAgent` (office toolbar), `focusAgent` (clicking a character), and
  `closeAgent` client messages (`webview-ui/src/App.tsx:123,142,150`,
  `components/BottomToolbar.tsx:71-80`). The office is natively a multi-agent,
  dynamic-lifecycle UI — we currently just never use it.

### 1.7 Lifecycle edge cases to design for

- **Reset-while-running** (issue #332): abort must become per-conversation; the
  abort-before-clear ordering and the "drop events from aborted run" guard
  (`chat-store.ts:174-176`, `app-core/chat.ts:198-200`) must key on the right
  conversation's controller.
- **Switch-while-streaming**: a backgrounded conversation's run keeps streaming
  into _its own_ event slice; switching only changes which slice the surface
  renders. Bounded snapshot collapse (`appendLiveChatEvent`,
  `projections.ts:339-357`) applies per slice, so memory stays bounded per
  conversation.
- **Send-while-another-runs**: the #334 `isSending` latch must be per
  conversation, not global.
- **Delete-while-running**: abort, settle that conversation's human prompts, then
  delete events + row + notify pixel agents (`agentClosed`).
- **Human prompts**: modal must say _which_ conversation is asking; Stop/reset
  settles only that conversation's queue.
- **Inspector / event-logger with N conversations**: inspector entries need a
  `conversationId` tag (filter panel to the active conversation; reset clears only
  that slice). The event-logger plugin logs via chat-event hooks per run — gets the
  conversation label in its context or stays as-is (cosmetic).
- **Cooldown**: stays global per deployment — one 429 gates _new_ sends in all
  conversations (deliberate; it's the same upstream key).

---

## 2. Design axes — options and recommendations

### Axis 1 — State architecture

|                                                                            | Option A: one store, state keyed by conversation id                                                                                           | Option B: store instance per conversation + registry                                          | Option C: extract a ConversationRunner actor per conversation; store(s) as projections |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Shape                                                                      | `ChatState = { conversations: Record<id, ConversationSlice>, activeId, order }`; closure `Map<id, {controller, isSending}>` for run isolation | Keep `createChatStore` as-is, instantiate N; a small registry store owns the list + active id | New non-React `ConversationRunner` class owns run/abort/persist; one thin UI store     |
| Run isolation                                                              | per-id entries in one closure map                                                                                                             | free (each store keeps its own closure)                                                       | strongest (explicit)                                                                   |
| Aggregate views (Pixel Agents needs **all** conversations' events+running) | trivial — one subscription                                                                                                                    | awkward: subscribe to N dynamic stores, resubscribe on create/delete                          | trivial via the projection store                                                       |
| React plumbing                                                             | `useChatStore` selectors keep working; add `useConversation(id)` / active-slice adapters                                                      | `useChatStore` must resolve a store dynamically — context surgery in every consumer           | medium; hooks read the projection store                                                |
| Risk / size                                                                | medium refactor of one file + selector adapters                                                                                               | lifecycle leaks (dispose/subscriptions), most consumer churn                                  | biggest diff, new abstraction layer                                                    |

**Recommendation: A.** Pixel Agents and `live-chat-activity` need the aggregate
view, which A gives for free; the per-run mutable bits (`AbortController`,
`isSending`) move into a closure `Map` keyed by conversation id, preserving the
#332/#334 semantics per conversation. C is cleaner in the abstract but is a new
layer we don't need — `executeChatPrompt` already _is_ the per-conversation
run function; A just stops the store from serializing it. B looks cheap but
pushes complexity into every consumer and into subscription lifecycle.

### Axis 2 — Persistence schema & migration

|                         | Option A: extend repository API only (no schema bump)                                                                                                                                    | Option B: schema v4 with per-conversation extras (title index, agent number, archived flag) |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Changes                 | add `listConversations()`, `deleteConversation(id)`, `updateConversationTitle(id, title)` to `ConversationRepository` + Dexie/shell impls; `conversations` table & indexes already exist | same + Dexie `version(4)` upgrade assigning e.g. stable numeric `agentNo`, title backfill   |
| Existing users          | zero migration; current conversation appears as the only list entry                                                                                                                      | upgrade pass over conversations table                                                       |
| Pixel agent numeric ids | mapped outside chat DB (see Axis 5)                                                                                                                                                      | baked into chat schema                                                                      |

**Recommendation: A.** The schema was built multi-conversation from day one; we
only add enumeration/deletion/title APIs. Keeping the pixel numeric-id mapping
_out_ of the chat DB (it's a Pixel-Agents presentation concern; lives in the
pixel-agents workspace DB next to seats/layout) preserves the package boundary —
`app-core` never learns about pixel agents. One wrinkle either way: old resets
left conversation rows with zero events; `listConversations` should either
surface them as empty conversations (fine) or `initializeChatState`'s successor
can lazily reuse the empty latest row (current behavior effectively does).
Title generation: default "New conversation" (already, `db.ts:182`), set from
the first user message (truncated) on first send — cheap, no LLM call.

### Axis 3 — Concurrency model

|                                       | Option A: truly parallel, per-conversation gate only                                                                                                      | Option B: one visible active run; others queue ("background continuation" = queued send) | Option C: parallel with a small client-side cap (2–3), extra sends refused/queued |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Matches issue ("run in parallel")     | yes                                                                                                                                                       | no (serialized)                                                                          | yes, bounded                                                                      |
| LiteLLM rpm/tpm/budget (per-user key) | shared budget; a 429 in any run sets the shared per-deployment cooldown that blocks **new** sends everywhere while in-flight runs auto-retry on their own | trivially safe                                                                           | protects the key from self-inflicted 429 bursts                                   |
| Complexity                            | per-conversation controllers (needed anyway)                                                                                                              | queue machinery + surprising UX                                                          | A + a counter                                                                     |

**Recommendation: A, with the cap as a follow-up knob if real usage trips
429s.** The existing per-deployment cooldown (issue #179 machinery) is already
the correct cross-conversation coordination point: it needs _no change_ to start
gating all conversations' sends the moment any run gets rate limited. Streaming
is N independent SSE fetches — browsers allow this fine on HTTP/2. The edge
inbound limits (auth/search/mcp scopes) are per credential and generous relative
to 2–4 parallel agents.

### Axis 4 — UI for start / switch / reset

|       | Option A: switcher in the chat surface header (dropdown/tab strip)            | Option B: dedicated conversation list sidebar panel  | Option C: the Pixel Agents office **is** the switcher (click agent = focus, toolbar = new, close = delete) |
| ----- | ----------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Where | both floating + docked headers, next to the existing Reset button             | docked mode only realistically; floating has no room | pixel-agents shell only                                                                                    |
| Cost  | small; degrades gracefully in every shell (web, widget, canvas, ide, mermaid) | new layout work per surface                          | zod-whitelist 3 more client messages (`launchAgent`, `focusAgent`, `closeAgent`) + wire to store actions   |
| Notes | shows per-conversation running/attention badge                                | classic chat-app UX, most discoverable               | delightful, and the upstream UI already has these affordances built in                                     |

**Recommendation: A + C together, skip B.** A is the universal control (a compact
dropdown listing conversations with a running-spinner/badge, "New conversation",
and per-conversation Reset/Delete in the existing header menu). C comes almost
free because the upstream office toolbar and character clicks already emit the
client messages — we only accept and route them; it makes the office the natural
"team dashboard" the issue is going for. B can be revisited later if
conversations multiply.

### Axis 5 — Pixel Agents projection (conversation → agent)

|                  | Option A: dynamic lifecycle (agentCreated/agentClosed) + per-conversation projection                                                                                                 | Option B: re-bootstrap (resend existingAgents/layout) on any conversation set change |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Mechanics        | bootstrap advertises all current conversations as agents; conversation created → `agentCreated`; deleted → `agentClosed`; each conversation's events projected with its own agent id | rebuild office state on every change                                                 |
| Upstream support | verified: both messages handled dynamically upstream                                                                                                                                 | works but characters teleport/re-seat; visible churn                                 |
| Seats            | persisted per agent id (already the upstream `saveAgentSeats` shape) + a conversationId ↔ agent-number map in the pixel workspace record                                             | same                                                                                 |

**Recommendation: A.** Concretely:

- **Identity**: a persisted map `conversationId → agentNumber` (small ints,
  monotonic counter) in `PixelAgentsWorkspaceRecord` next to `layout`; seats stay
  keyed by agent number (upstream's shape, `protocol.ts:53-70`), and
  `saveAgentSeats` persists _all_ entries instead of only `'1'`.
- **Projection**: `messagesForChatEvent(event, agentId)` gains the id parameter;
  the stage runs one `useLiveChatActivity` per conversation (or a generalized
  multi-stream variant) with `folderNames[agentId] = conversation title`.
- **Reset**: agent stays seated; project `agentToolsClear` + `agentStatus:
waiting` (exactly what run-end does today). **Delete**: `agentClosed`, seat
  entry dropped, mapping entry retired (numbers never reused, so stale seats
  can't mis-bind).
- **Bounds**: unbounded agent growth is prevented by delete being a first-class
  action; if we want a soft cap on _conversations_ (e.g. 8) that's an app-level
  guard, not a pixel one.

---

## 3. Staged implementation plan (each PR independently mergeable, behavior-preserving until the final enablement)

1. **PR 1 — repository enumeration APIs** (`app-core/ports.ts`, `app-browser/db.ts`,
   `shell.ts`): `listConversations`, `deleteConversation`,
   `updateConversationTitle`. No schema bump; unit tests incl. delete-removes-events.
   Nothing calls them yet → zero behavior change.
2. **PR 2 — chat store keyed by conversation id** (the heart): `ChatState`
   becomes `{ conversations: Record<id, slice>, activeId }` with per-id run
   controllers/latches; public selector API kept compatible via active-slice
   adapters so every existing consumer (`surfaces.tsx`, media-registry,
   context-gauge, pixel page) compiles unchanged and behavior is identical with
   one conversation. Regression tests: #332 reset-while-running, #334 double-send,
   now per conversation; new tests for two-conversation isolation.
3. **PR 3 — human-prompt + inspector scoping**: `requestHumanInput` carries a
   scope (conversation id) threaded from the runtime; `resetHumanPrompts(scope)`;
   modal labels the source conversation. Inspector entries tagged with
   conversation id; reset clears only that slice. Single-conversation behavior
   unchanged.
4. **PR 4 — conversation switcher UI + parallel enablement**: header dropdown
   (list/switch/new/reset/delete, running badges) in floating + docked surfaces;
   per-conversation send gate replaces the global one; title-from-first-prompt.
   e2e: parallel streams in two conversations (mock LiteLLM, two interleaved SSE
   streams), switch-while-streaming, reset-one-while-other-runs,
   persistence/reload of N conversations. Bundle budgets: switcher ships inside
   the already-lazy chat surface chunks (watch the canvas entry guard;
   measure develop in a throwaway worktree before raising any budget).
5. **PR 5 — Pixel Agents multi-agent projection**: protocol additions
   (`agentCreated`/`agentClosed` server msgs; accept `launchAgent`/`focusAgent`/
   `closeAgent` client msgs), per-conversation activity projection, agent-number
   mapping + full seat persistence, office-driven new/switch/close wired to the
   store. e2e: two conversations → two seated characters; only the running one
   animates (reuse the captured-traffic replay fixtures from
   `packages/e2e/fixtures/pixel-agents.ts` / `mock-litellm.ts`); seat + layout
   survive reload; delete removes the character.

Each PR: full `typecheck`, `lint`, `pnpm check:boundaries`, `knip`,
`pnpm format:check`, unit + bundle tests, e2e, husky (no `--no-verify`); root
eslint on staged test files before committing (husky lints tests even where
package lint doesn't).

## 4. Test strategy summary

- **Unit**: repository APIs (Dexie fake/indexeddb shim as existing tests do);
  keyed store (isolation of abort/latch/events; #332/#334 per conversation;
  rate-limit event from run A sets shared cooldown gating run B's _send_ but not
  its in-flight stream); `messagesForChatEvent` with agent ids; seat-map
  round-trip; human-prompt scope settlement.
- **e2e** (grounded in captured real traffic per project convention):
  - two conversations streaming **concurrently**, both transcripts correct;
  - switch-while-streaming keeps the background stream alive;
  - reset conversation A mid-run leaves B's run untouched (regression of #332
    generalized);
  - pixel agents: N characters, per-agent animation assertion (extend the
    existing animation-probe test), office toolbar creates a conversation,
    clicking a character switches the assistant panel, closing removes it;
  - reload: conversation list, active id, seats, layout all persist.
- **Bundle/perf**: entry-chunk budgets unchanged (switcher lives in lazy chunks);
  memory bound per conversation via existing `appendLiveChatEvent` collapse.

## 5. Decisions (answered by the human, 2026-07-15)

1. **UI scope: all chat surfaces.** The switcher ships in both floating and
   docked headers, so every shell (web, widget, canvas, ide, mermaid,
   pixel-agents) gets it in PR 4.
2. **Concurrency: capped at ~3 concurrent runs.** Parallel streaming is enabled,
   but a client-side cap (constant, e.g. `MAX_CONCURRENT_RUNS = 3`) gates
   `sendPrompt`: a send that would exceed the cap is **refused with a visible
   notice** in that conversation's surface (no queueing machinery — predictable,
   and the user can simply retry when a run finishes). The cap counts running
   runs across all conversations; the shared per-deployment cooldown continues
   to gate all new sends on any 429.
3. **Delete is in scope.** Delete = abort that conversation's run, settle its
   human prompts, drop events + conversation row, `agentClosed` to the office,
   retire (never reuse) its agent number and seat entry.
4. **Interactive office.** The bridge accepts `launchAgent` / `focusAgent` /
   `closeAgent` client messages: office toolbar starts a new conversation,
   clicking a character makes that conversation active in the assistant panel,
   closing a character deletes the conversation (with the same confirm guard as
   the header delete action).

### Post-review amendments (2026-07-17)

Recorded during the architecture-hardening pass (#430-6) that followed
implementation, as a correction to decision #4 above:

- **`launchAgent` has no reachable production UI today.** Decision #4 reads as
  though the office toolbar's "+ Agent" button is a second, equally-live entry
  point for starting a conversation alongside the header switcher. In practice,
  upstream's "+ Agent" button (`webview-ui/src/components/BottomToolbar.tsx`)
  only renders in a VS Code extension host context that this integration does
  not provide — TinyTinkerer's embedding never surfaces that button, so
  `launchAgent` is never actually sent by the bundled office UI we ship.
  Conversation creation in production is switcher-only (the header "New
  conversation" affordance from decision #1); `focusAgent` and `closeAgent`
  ARE reachable (clicking/closing a character), since those affordances render
  unconditionally.
- **Why the code stays as-is.** `pixel-agents-stage.tsx` still accepts and
  handles `launchAgent` (routing it to `startNewConversation`, same as the
  switcher) — this is deliberate forward-compatibility, not dead code: it
  costs one already-written, already-tested branch, matches upstream's
  message contract exactly, and starts working for free the moment any future
  embedding (or an upstream change) exposes the button. It is exercised by
  `packages/e2e` coverage of the office-driven actions rather than by any
  discoverable in-app control — see the acceptance site's comment in
  `packages/app/pixel-agents/src/protocol.ts` for the pointer back here.

### Post-implementation update (2026-07-24)

The header `ConversationSwitcher` described throughout this doc (Axis 4's
"A + C together") has been **removed from every chat surface**, not just
`apps/pixel-agents`. The office (character clicks, a new TinyTinkerer-owned
`+ Agent` button, and the character "×") is now the sole conversation
management surface across the whole product — every other app (`shell`,
`ide`, `canvas`, `mermaid`) is read/reset-only against whichever conversation
is currently active, relying on the shared same-origin IndexedDB
(`storageNamespace: 'tinytinkerer'`) to stay in sync with what the office
last selected.

The new `+ Agent` button lives in `packages/app/pixel-agents/src/pixel-agents-stage.tsx`,
rendered in TinyTinkerer's own chrome outside the sandboxed iframe, calling
`actions.startNewConversation()` directly. It does **not** use the `launchAgent`
bridge message — upstream's own native button (the reason `launchAgent` was
kept as forward-compat, see above) turned out to never mount in this
embedding at all (`{!isBrowserRuntime && (...)}` is a React conditional, not a
CSS class, so it can't be revealed by the injected stylesheet the way
"Settings" is hidden). `launchAgent` itself is untouched and still accepted,
still exercised only by e2e.

### Post-implementation update (2026-07-24, superseding the one above)

TinyTinkerer's own `+ Agent` button (previous update) has been **removed**.
Upstream's own native button now renders and is used instead — the "never
mounts in this embedding" conclusion above held for the render gate in
isolation, but a fuller investigation found the gate itself is just
`typeof acquireVsCodeApi !== 'undefined'` (`~/pixel-agents/webview-ui/src/runtime.ts`),
a plain global feature-detection check, not something structurally tied to
running inside real VS Code.

`scripts/pixel-agents-bridge.mjs`'s injected script now defines
`window.acquireVsCodeApi` (replacing its previous `window.WebSocket` shim
entirely — both flip the same `isBrowserRuntime` constant, which upstream
also uses to choose its message transport, so only one shim can be active at
a time). This makes upstream treat the embedding as a VS Code webview: its
`+ Agent` button renders, and its transport switches from `WebSocketTransport`
to `PostMessageTransport`. Concretely:

- iframe -> host messages stay enveloped exactly as before (`{ channel,
direction: 'client', payload }`) — that shape is written by our own shim's
  `postMessage` implementation, not upstream's code, so `pixel-agents-stage.tsx`'s
  inbound listener needed no changes.
- host -> iframe messages are now sent RAW (unenveloped): upstream's
  `PostMessageTransport.onMessage` reads `event.data` directly as the message,
  with no envelope-unwrapping of its own. `postToPixelAgents` in
  `pixel-agents-stage.tsx` was updated accordingly.
- Clicking the button sends a real `launchAgent` client message (with 0-1
  workspace folders, since this integration never sends a `workspaceFolders`
  message, the click always goes straight to sending it — no folder-picker
  dropdown ever appears), handled exactly as before by the already-existing,
  already-tested `launchAgent` case in `pixel-agents-stage.tsx`.
- The button's "Skip permissions mode" hover dropdown (sends `launchAgent`
  with `bypassPermissions: true`, a field this single-workspace integration
  has no meaning for) is removed via a new source-level patch
  (`scripts/pixel-agents-source-patch.mjs`), applied to the freshly cloned
  pinned commit before it's built — `Dropdown` fully unmounts rather than
  CSS-hiding, and its items share generic classes with the legitimate
  folder-picker dropdown, so this could not be done as a post-build CSS
  injection the way "Settings" is hidden.

`DockablePanelLayout`'s `headerActions` slot (added to host the previous
button in the panel header, away from the iframe's hit-test area) was reverted
— nothing else uses it.
