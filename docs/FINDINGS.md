<!--
Code review findings collected from parallel subagent review of the feat/rate-limit-prevention branch.
Each finding includes severity, options, and a recommendation. Duplicates across review areas are noted.
Prioritize by severity then area.
-->

# Code Review Findings

**Branch:** `feat/rate-limit-prevention`  
**Date:** 2026-05-25  
**Areas covered:** Architecture, Security, Correctness, Content Platform, Edge Backend

> Two findings are noted as duplicates across review areas:
> - **SEC-005 ≈ CONTENT-001** (Mermaid SVG dangerouslySetInnerHTML — same issue, same fix)
> - **SEC-006 ≈ CONTENT-005** (Image URL protocol validation — same issue, same fix)

---

## Summary Table

| ID | Severity | Area | Title |
|----|----------|------|-------|
| [EDGE-001](#edge-001) | high | Edge Backend | x-ratelimit-reset-* header treated as relative seconds, may be absolute epoch |
| [EDGE-002](#edge-002) | high | Edge Backend | Proactive RateLimitError caught by recovery logic — potential infinite loop |
| [ARCH-001](#arch-001) | high | Architecture | host app declares workspace dependencies on other apps in package.json |
| [LOGIC-001](#logic-001) | high | Correctness | rate.limit.cancelled persists cooldown, blocking UI after cancellation |
| [LOGIC-002](#logic-002) | high | Correctness | updateFromHeaders unconditionally clears heuristicBackoffMs even on error responses |
| [CONTENT-002](#content-002) | high | Content Platform | MermaidNodeRenderer and WireframeNodeRenderer statically imported — lazy loading defeated |
| [CONTENT-001](#content-001) | high | Content Platform | Mermaid SVG injected via dangerouslySetInnerHTML without independent sanitization *(see also SEC-005)* |
| [SEC-001](#sec-001) | medium | Security | Upstream error body reflected to client in 429 response |
| [SEC-002](#sec-002) | medium | Security | GitHub access token used as a Map cache key |
| [SEC-003](#sec-003) | medium | Security | GitHub access token stored unencrypted in IndexedDB; clearStoredToken writes `""` instead of deleting |
| [SEC-004](#sec-004) | medium | Security | No authentication required on /api/search endpoint |
| [ARCH-002](#arch-002) | medium | Architecture | brand-assets depends on contracts — not covered by any architecture rule |
| [ARCH-003](#arch-003) | medium | Architecture | app-browser has direct contracts dependency not documented in architecture rules |
| [EDGE-003](#edge-003) | medium | Edge Backend | Race condition: quota state read before request, updated after — concurrent requests bypass throttling |
| [EDGE-004](#edge-004) | medium | Edge Backend | Heuristic backoff cleared unconditionally on any successful response headers |
| [EDGE-005](#edge-005) | medium | Edge Backend | Edge /api/models/chat leaks unhelpful error for unmapped upstream status codes |
| [EDGE-006](#edge-006) | medium | Edge Backend | No edge tests for 429 response shape or Retry-After header forwarding |
| [EDGE-007](#edge-007) | medium | Edge Backend | parseRetryAfterMs duplicated between edge and browser packages |
| [LOGIC-003](#logic-003) | medium | Correctness | executeChatPrompt may persist user.message events, risking duplicate messages on replay |
| [LOGIC-004](#logic-004) | medium | Correctness | buildTurns overwrites earlier notice if multiple notice events arrive in same turn |
| [LOGIC-005](#logic-005) | medium | Correctness | createBrowserRuntimeFactory searchEnabled snapshotted at wrong lifecycle in tests |
| [LOGIC-006](#logic-006) | medium | Correctness | parseBool treats any non-'false' string (including "") as true |
| [CONTENT-003](#content-003) | medium | Content Platform | Module-level mermaid state never reset between test runs — cross-test contamination |
| [CONTENT-004](#content-004) | medium | Content Platform | ChoicePromptNode renders as interactive-looking list with no interactivity indication |
| [CONTENT-005](#content-005) | medium | Content Platform | ImageNode renders URLs without protocol validation *(see also SEC-006)* |
| [SEC-005](#sec-005) | medium | Security | Mermaid SVG injected via dangerouslySetInnerHTML without independent sanitization *(duplicate of CONTENT-001)* |
| [SEC-006](#sec-006) | low | Security | Image URLs from assistant content rendered without protocol validation *(duplicate of CONTENT-005)* |
| [SEC-007](#sec-007) | low | Security | CORS defaults to wildcard (*) when no ALLOWED_ORIGIN(S) configured |
| [SEC-008](#sec-008) | low | Security | No rate limiting on /auth/github/exchange endpoint |
| [SEC-009](#sec-009) | low | Security | Widget hostToken sourced from untrusted window config without validation |
| [ARCH-004](#arch-004) | low | Architecture | Orphaned package directories without package.json left in packages/ tree |
| [LOGIC-007](#logic-007) | low | Correctness | sendPrompt finally block clears isRetryPending — potential masking on mid-stream error |
| [LOGIC-008](#logic-008) | low | Correctness | buildCurrentTimeline silently includes all events when no user.message found |
| [LOGIC-009](#logic-009) | low | Correctness | AgentRuntime emits execution.step.completed even when note is empty |
| [LOGIC-010](#logic-010) | low | Correctness | canSendPrompt has no direct unit tests |
| [CONTENT-006](#content-006) | low | Content Platform | Fragment key uses type+index — unnecessary DOM reconciliation during streaming |
| [CONTENT-007](#content-007) | low | Content Platform | No integration test for mixed node type ordering end-to-end |
| [EDGE-008](#edge-008) | low | Edge Backend | modelsCache never expires — stale model list after token rotation or GitHub model changes |
| [EDGE-009](#edge-009) | low | Edge Backend | cors.ts Vary: Origin logic is correct but unclear; needs a comment |
| [EDGE-010](#edge-010) | low | Edge Backend | fetchWithTimeout silently drops caller's AbortSignal |

---

## Architecture

### ARCH-001

**Severity:** high  
**Title:** host app declares workspace dependencies on other apps in package.json

**Description:**  
`apps/host/package.json` lists `@tinytinkerer/web`, `@tinytinkerer/widget`, and `@tinytinkerer/mobile` as runtime dependencies. The architecture rule states no app may import from another app. Although the host's source files only resolve filesystem paths to these apps and never import their JS modules, having them in `package.json` as workspace dependencies still models a cross-app dependency edge that violates the stated rule at the manifest level and could allow accidental module-level imports in the future.

**Options:**
1. Remove the `@tinytinkerer/*` app entries from `host/package.json` and replace path resolution with hardcoded relative paths or a workspace-root constant. The `host-server.mjs` already computes paths via `resolve(currentDir, '../../..')` so the workspace dependency is redundant.
2. Move `build-pages.mjs` and `host-server.mjs` to a dedicated tooling script at the monorepo root so it is not subject to the cross-app import constraint.
3. Introduce an explicit 'orchestrator' category in the architecture docs exempt from the cross-app import rule, and document host as belonging to it.

**Recommendation:** Option 1. The host does not import source code from other apps — only their built output directories by path. Removing the workspace dependencies costs nothing and cleanly satisfies the rule.

---

### ARCH-002

**Severity:** medium  
**Title:** brand-assets depends on contracts — no rule covers this package

**Description:**  
`packages/brand-assets/package.json` declares `@tinytinkerer/contracts` as a dependency and imports `brandDefinitionSchema` and `BrandDefinition` from it. The architecture rules enumerate allowed dependencies for every other package layer but say nothing about `brand-assets`. Because `app-browser` depends on `brand-assets`, the transitive chain is: `browser apps → app-browser → brand-assets → contracts`. If `brand-assets` is ever imported by a layer below `app-browser`, the contracts coupling will follow.

**Options:**
1. Add `brand-assets` to the architecture docs with an explicit rule: "brand-assets may depend on contracts and nothing else."
2. Inline the `BrandDefinition` type and small validation into `brand-assets/src/index.ts`, removing the contracts dependency entirely.
3. Move the `BrandDefinition` schema into a dedicated lightweight sub-path export of contracts.

**Recommendation:** Option 2 is cleaner long-term. The Zod parse can be replaced with a TypeScript type assertion, removing the cross-package coupling. Option 1 is the lowest-risk fix if validation is desired.

---

### ARCH-003

**Severity:** medium  
**Title:** app-browser has a direct contracts dependency not documented in the architecture rules

**Description:**  
`packages/app-browser/package.json` lists both `@tinytinkerer/app-core` and `@tinytinkerer/contracts` as direct dependencies. The architecture docs describe `app-browser` as the composition boundary above `app-core` but do not explicitly state whether it may also depend on contracts directly. In practice, several source files import contracts types. If the intent is that contracts should always flow through `app-core`, this is a violation; if direct import is intentional it should be documented.

**Options:**
1. Update the architecture docs to explicitly state "app-browser may depend on app-core, content-* packages, brand-assets, and contracts." No code change needed.
2. Audit which contracts imports could be satisfied through app-core re-exports and remove the direct dependency.
3. Accept the current state and add a tracking issue to re-evaluate when app-core's API surface is larger.

**Recommendation:** Option 1. `app-browser` is the declared composition boundary and commonly needs domain types directly. Requiring them to flow through `app-core` would be artificial indirection. The docs should reflect reality.

---

### ARCH-004

**Severity:** low  
**Title:** Orphaned package directories without package.json left in packages/

**Description:**  
Four directories exist under `packages/` with no `package.json` and no source files: `config`, `feature-markdown`, `shared`, and `types`. They contain only leftover `.turbo/` artifacts. Because `pnpm-workspace.yaml` uses `packages/*` as a glob, pnpm may attempt to resolve these as workspace packages, causing warnings or failures during install.

**Options:**
1. Delete the four directories entirely — they contain no source files and are not in git.
2. Run `pnpm store prune` and rely on pnpm to ignore them, then add to `.gitignore`.
3. Add explicit workspace exclusions to `pnpm-workspace.yaml`.

**Recommendation:** Option 1. The directories have no source files and are not in git. Deleting removes all ambiguity and prevents a developer from accidentally adding files there.

---

## Security

### SEC-001

**Severity:** medium  
**Title:** Upstream error body reflected to client in 429 rate-limit response

**Description:**  
In `apps/edge/src/lib/rate-limit.ts` line 36, the raw response body text from the GitHub Models upstream (`rawText`) is placed directly into the `error` field returned to clients. If GitHub's upstream includes internal details or attacker-influenced content in a 429 body, this is reflected verbatim to all callers.

**Options:**
1. Replace `rawText` with a static generic message such as "GitHub Models rate limit reached" and discard the upstream body.
2. Cap the upstream error string at a safe length (200 chars) and strip non-printable characters before forwarding.
3. Log `rawText` server-side for diagnostics but always return a static message to the client.

**Recommendation:** Option 3: log internally for debugging and return a fixed static string to clients, eliminating any reflected-content risk while preserving observability.

---

### SEC-002

**Severity:** medium  
**Title:** GitHub access token used as a Map cache key in memory

**Description:**  
In `packages/app-browser/src/github-models.ts` lines 30–44, the module-level `modelsCache` Map uses `` `${edgeBaseUrl}:${token}` `` as its key. The full bearer token is stored as a key in a long-lived in-memory Map, enumerable via devtools or prototype-pollution attacks.

**Options:**
1. Hash the token (SubtleCrypto SHA-256) before using it as the cache key.
2. Key the cache on a stable token fingerprint returned from an API call, not the raw token.
3. Eliminate the in-memory cache and rely on HTTP caching or a short TTL per-request memo.

**Recommendation:** Option 1: derive a SHA-256 hash for the cache key. Small change, retains caching benefit, raw credential is never a retrievable Map key.

---

### SEC-003

**Severity:** medium  
**Title:** GitHub access token stored unencrypted in IndexedDB; clearStoredToken writes "" instead of deleting

**Description:**  
In `packages/app-browser/src/db.ts` lines 77–91, the GitHub OAuth access token is persisted to IndexedDB in plaintext. Additionally, `clearStoredToken` (line 85) writes an empty string `''` rather than deleting the record, leaving a tombstone that causes subtle state bugs.

**Options:**
1. Encrypt the token before writing (AES-GCM via Web Crypto) and fix `clearStoredToken` to call `db.preferences.delete('github_access_token')`.
2. Store only a short-lived session reference in IndexedDB; keep actual token in memory only.
3. Accept the current storage model but fix the `clearStoredToken` bug to call `delete` rather than write `''`.

**Recommendation:** Option 3 is the minimum viable fix. Storing OAuth tokens in IndexedDB is a common SPA pattern and acceptable given limited token scope. The `clearStoredToken` bug should be fixed immediately.

---

### SEC-004

**Severity:** medium  
**Title:** No authentication required on /api/search endpoint

**Description:**  
In `apps/edge/src/routes/search.ts` lines 42–89, the POST `/api/search` endpoint only checks whether `TAVILY_API_KEY` is configured. It does not verify any `Authorization` header. Any unauthenticated party that can reach the edge worker can consume the operator's Tavily API quota freely.

**Options:**
1. Add an `Authorization` header check at the start of the handler, matching the pattern in `routes/models.ts` line 49–52.
2. Add a pre-shared secret check via a custom header (`X-API-Key`) validated against an env variable.
3. Rate-limit search requests per IP and add CORS restriction so only known origins can reach it.

**Recommendation:** Option 1: require `Authorization: Bearer <github-token>`, consistent with the existing model routes. One-line guard, eliminates unauthenticated quota abuse.

---

### SEC-005

**Severity:** medium  
**Title:** Mermaid SVG injected via dangerouslySetInnerHTML without independent sanitization

> **Duplicate of CONTENT-001.** Same issue, same root cause, same fix.

**Description:**  
In `packages/content-mermaid/src/index.tsx` line 103, the SVG string produced by `mermaid.render()` is set via `dangerouslySetInnerHTML`. Mermaid uses `securityLevel: 'strict'` internally but no independent sanitizer layer exists between the API output and the DOM.

**Options:**
1. Run the SVG string through DOMPurify (`{ USE_PROFILES: { svg: true, svgFilters: true } }`) before `dangerouslySetInnerHTML`.
2. Render Mermaid diagrams inside a sandboxed `<iframe>`.
3. Keep current approach and document the trust boundary.

**Recommendation:** Option 1: add DOMPurify as a defense-in-depth layer independent of Mermaid's internal sanitizer.

---

### SEC-006

**Severity:** low  
**Title:** Image URLs from assistant content rendered without protocol validation

> **Duplicate of CONTENT-005.** Same issue, same fix.

See [CONTENT-005](#content-005).

---

### SEC-007

**Severity:** low  
**Title:** CORS defaults to wildcard (*) when no ALLOWED_ORIGIN(S) configured

**Description:**  
In `apps/edge/src/lib/cors.ts` lines 53–55, `resolveAllowedOrigin` returns `'*'` when `ALLOWED_ORIGIN` and `ALLOWED_ORIGINS` are both absent. A wildcard combined with an `Authorization` header means any web page can send credentialed cross-origin requests in a misconfigured deployment.

**Options:**
1. Fail closed: omit the CORS header entirely when no allowlist is configured. Add `ALLOW_ALL_ORIGINS=true` as an explicit development opt-in.
2. Emit a startup warning log when no origin restriction is configured.
3. Keep the wildcard default but add documentation and a deployment checklist item.

**Recommendation:** Option 1: fail closed. Unintended deployments should be restrictive by default.

---

### SEC-008

**Severity:** low  
**Title:** No rate limiting on /auth/github/exchange endpoint

**Description:**  
In `apps/edge/src/routes/auth.ts` lines 13–52, the OAuth code exchange endpoint has no IP-based rate limiting. An attacker generating a high volume of requests could exhaust GitHub's OAuth exchange rate limits for the application's client ID.

**Options:**
1. Add Cloudflare Workers rate limiting (Rate Limiting API or KV-backed counter) to restrict exchange attempts per IP.
2. Validate that `code` matches the expected GitHub format before forwarding.
3. Accept the risk given GitHub itself rate-limits OAuth exchanges per client application.

**Recommendation:** Option 1: add a Cloudflare rate limit binding. GitHub's per-app quota (Option 3) is partially mitigating but a local guard prevents log noise and protects against coordinated abuse.

---

### SEC-009

**Severity:** low  
**Title:** Widget hostToken sourced from untrusted window config without validation

**Description:**  
In `apps/widget/src/main.tsx` line 14, the widget reads `window.__TINYTINKERER_WIDGET_CONFIG__` and uses `hostToken` directly as the GitHub bearer token. Any JavaScript on the embedding page before widget initialization can overwrite this config.

**Options:**
1. Document the trust boundary clearly — the embedding page is fully trusted, so this is expected behavior.
2. Freeze the config object (`Object.freeze(hostConfig)`) immediately after reading and ensure the widget script loads before third-party scripts.
3. Move to a `postMessage`-based configuration channel with origin validation.

**Recommendation:** Option 2: call `Object.freeze` immediately after reading and document the trust model.

---

## Correctness

### LOGIC-001

**Severity:** high  
**Title:** rate.limit.cancelled persists a non-empty retryAt cooldown, blocking the UI after cancellation

**Description:**  
In `packages/app-core/src/chat.ts` lines 72–78, `applyRateLimitEvent` handles `rate.limit.cancelled` by writing `event.payload.retryAt` to the preferences store and returning `{ cooldownUntil: event.payload.retryAt, isRetryPending: false }`. This means when a retry is explicitly cancelled by the user (`reason: 'cancelled'`) or because the wait is too long (`reason: 'too_long'`), the UI still shows a cooldown countdown. Only `rate.limit.recovered` clears the cooldown (line 80).

**Options:**
1. Clear the cooldown on cancellation: set `RATE_LIMIT_COOLDOWN_KEY` to `''` and return `{ cooldownUntil: undefined, isRetryPending: false }` for the `rate.limit.cancelled` branch.
2. Differentiate by reason: clear cooldown for `reason === 'cancelled'` (user-aborted) but keep it for `reason === 'too_long'`.
3. Remove the `cooldownUntil` state update entirely from the cancelled branch.

**Recommendation:** Option 2. A user-initiated cancellation should clear the cooldown so the user can retry immediately. A `'too_long'` cancellation reflects a real server-side rate limit and should preserve `retryAt` until it expires.

---

### LOGIC-002

**Severity:** high  
**Title:** updateFromHeaders unconditionally clears heuristicBackoffMs even on error responses

**Description:**  
In `packages/app-browser/src/runtime/quota-tracker.ts` line 72, `updateFromHeaders` always sets `this.heuristicBackoffMs = 0` at the end, including when called on a 429 response. In `github-models-provider.ts` lines 143–149, `updateFromHeaders` is called before the 429 check and then `recordRateLimit` is called after. Any reordering or new call path that calls `updateFromHeaders` on a 429 but omits `recordRateLimit` would silently discard heuristic protection.

**Options:**
1. Accept a `statusCode` or `isSuccess` parameter in `updateFromHeaders` and only clear `heuristicBackoffMs` when the response succeeded.
2. Split into `updateFromSuccessHeaders(headers)` and `updateFromHeaders(headers)` (no backoff reset).
3. Move `this.heuristicBackoffMs = 0` out of `updateFromHeaders` into a separate `clearHeuristicBackoff()` method, called explicitly after confirmed success.

**Recommendation:** Option 3: extracting `clearHeuristicBackoff()` is a small targeted change that makes the call-site in `github-models-provider.ts` explicit about when heuristic protection is lifted.

---

### LOGIC-003

**Severity:** medium  
**Title:** executeChatPrompt may persist user.message events, risking duplicate messages on replay

**Description:**  
In `packages/app-core/src/chat.ts` lines 126–138, all non-`assistant.chunk` events are passed to `appendEvent`. This includes `user.message` events emitted by `AgentRuntime`. If `loadConversationEvents` replays already include `user.message`, rebuilding conversation history via `buildConversationHistory` could create duplicate user messages.

**Options:**
1. Guard `appendEvent` with an explicit allowlist of event types that should be persisted.
2. Verify (and add a test) that `loadConversationEvents` replays include `user.message` events and that `buildConversationHistory` correctly deduplicates them.
3. Restructure `executeChatPrompt` to collect persistable events in one pass, then batch-persist after the stream ends.

**Recommendation:** Option 1: define an explicit list of event types that are persisted, rather than relying on "everything except assistant.chunk." Prevents accidental persistence of new event types.

---

### LOGIC-004

**Severity:** medium  
**Title:** buildTurns overwrites earlier notice if multiple notice events arrive in the same turn

**Description:**  
In `packages/app-core/src/projections.ts`, the `error`, `system`, and `rate.limit.waiting/cancelled` branches all overwrite `pendingTurn.notice` by direct assignment. If two notice-generating events appear before `assistant.done` (e.g. a `system` event followed by `rate.limit.waiting`), the earlier notice is silently discarded.

**Options:**
1. Change `Turn.notice` from a single object to an array of notices (`notice?: Notice[]`) and push each notice onto the array.
2. Apply a priority scheme: only set `notice` if `pendingTurn.notice` is undefined, so the first notice wins.
3. Only keep the highest-severity notice (`error > rate-limit > system`).

**Recommendation:** Option 1 (array) is most correct but requires UI changes. Option 3 (highest-severity wins) is a safe short-term fix that surfaces the most actionable notice.

---

### LOGIC-005

**Severity:** medium  
**Title:** createBrowserRuntimeFactory searchEnabled snapshotted at wrong lifecycle in tests

**Description:**  
In `packages/app-browser/src/runtime/get-runtime.ts` lines 17–20, `searchEnabled` is evaluated when `create()` is called. In `get-runtime.test.ts`, `createRuntime()` is called at the outer function scope before `beforeEach` runs, so `mockSettings` mutations in `beforeEach` don't affect already-constructed runtimes. This could cause false-passing tests.

**Options:**
1. Move the `createRuntime()` call inside each test (or `beforeEach`) so each test gets a fresh runtime reflecting current mock state.
2. Document the factory's "snapshot on create()" semantics so future test authors know to call `create()` after setting up mocks.
3. Add a test that mutates `mockSettings.searchEnabled` after calling `createRuntime()` to confirm the expected behavior.

**Recommendation:** Option 1: calling `createRuntime()` inside each test body is idiomatic for unit tests and eliminates ambiguity.

---

### LOGIC-006

**Severity:** medium  
**Title:** parseBool treats any non-'false' string (including "") as true

**Description:**  
In `packages/app-core/src/settings.ts` lines 19–25, `parseBool` returns `true` for any value that is not `'false'` and not `undefined`. This means if the preferences store returns `''` (e.g. from `RATE_LIMIT_COOLDOWN_KEY` set to `''` in `initializeChatState`), the function incorrectly returns `true` instead of falling back to the default.

**Options:**
1. Change `parseBool` to return `true` only for the exact string `'true'`, `false` for `'false'`, and fall back to the `fallback` parameter for any other value.
2. Normalize the preferences store so `get()` returns `undefined` for empty strings.
3. Add an explicit `isBooleanTrue` check: `value === 'true' ? true : value === 'false' ? false : fallback`.

**Recommendation:** Options 1 and 3 are equivalent and both correct. An explicit `value === 'true'` guard makes semantics unambiguous and handles garbage values gracefully.

---

### LOGIC-007

**Severity:** low  
**Title:** sendPrompt finally block clears isRetryPending — potential masking on mid-stream error

**Description:**  
In `packages/app-browser/src/stores/chat-store.ts` lines 94–100, the `finally` block always sets `{ isRunning: false, isRetryPending: false }`. If `executeChatPrompt` throws after `onRateLimitState` has set `isRetryPending: true`, the `finally` block does reset it — which is actually correct behavior since `AgentRuntime` handles the wait internally. The current behavior is correct but undocumented.

**Options:**
1. Only reset `isRetryPending` in `finally` if there is no active cooldown.
2. Accept the current behavior as correct: by the time `finally` runs, the retry has completed or failed.
3. Add a test verifying `isRetryPending` is `false` after `sendPrompt` resolves regardless of rate-limit events.

**Recommendation:** Options 2 + 3: behavior is correct, add a test to document the invariant and prevent future regressions.

---

### LOGIC-008

**Severity:** low  
**Title:** buildCurrentTimeline silently includes all events when no user.message found

**Description:**  
In `packages/app-core/src/projections.ts` lines 149–165, `buildCurrentTimeline` scans backward for the last `user.message` event. If none is found, `startIndex` remains 0 and the entire events array is used, which could surface confusing timeline entries when events only contain tool/system events without a leading user message.

**Options:**
1. Return `[]` immediately if no `user.message` event is found, making the "no current turn" case explicit.
2. Document the current fallback-to-zero behavior as intentional.
3. Add a test for the no-`user.message` case to pin current behavior.

**Recommendation:** Option 1 is cleaner semantically. A one-line guard (`if (startIndex === 0 && events[0]?.type !== 'user.message') return []`) makes intent explicit.

---

### LOGIC-009

**Severity:** low  
**Title:** AgentRuntime emits execution.step.completed even when note is empty

**Description:**  
In `packages/app-core/src/runtime/agent-runtime.ts` lines 94–102, `execution.step.completed` is always emitted with `{ stepId, note }` regardless of whether `note` is empty. The existing guards in `thinkingLabel` and `context.notes` correctly handle empty notes, so this is not an active bug, but the event is emitted unnecessarily.

**Options:**
1. Only emit `execution.step.completed` with `note` field omitted when the note is empty; update the schema to make `note` optional.
2. Accept current behavior since the guards handle empty notes correctly.
3. Add a test verifying `execution.step.completed` events with empty notes don't appear in timeline output.

**Recommendation:** Options 2 + 3: existing guards are sufficient. Add a test to protect against regressions.

---

### LOGIC-010

**Severity:** low  
**Title:** canSendPrompt has no direct unit tests

**Description:**  
`packages/app-core/src/chat.ts` line 91–92, `canSendPrompt` calls `activeCooldown(state.cooldownUntil)` and is a guard for a critical user-facing action (sending messages). It is tested only implicitly through store integration. There are no direct unit tests covering its conditions.

**Options:**
1. Add unit tests covering: (a) no conversationId, (b) isRunning true, (c) active cooldown, (d) expired cooldown, (e) all conditions clear.
2. Export `canSendPrompt` from the core index and add tests alongside existing `activeCooldown` tests.
3. Accept current implicit coverage through integration tests.

**Recommendation:** Option 1: direct unit tests make failures easier to diagnose and prevent regression when guard conditions change.

---

## Content Platform

### CONTENT-001

**Severity:** high  
**Title:** Mermaid SVG injected via dangerouslySetInnerHTML without independent sanitization

> **See also SEC-005** — same issue reported by the security agent.

**Description:**  
In `packages/content-mermaid/src/index.tsx` line 103, the SVG string from `mermaid.render()` is set via `dangerouslySetInnerHTML`. While Mermaid is configured with `securityLevel: 'strict'` (line 28), there is no independent sanitization layer. If Mermaid is subverted (compromised CDN, prototype pollution, future library regression), unsanitized SVG with embedded scripts could execute.

**Options:**
1. Add a DOMPurify sanitization pass (`{ USE_PROFILES: { svg: true, svgFilters: true } }`) before `dangerouslySetInnerHTML`.
2. Render Mermaid inside a sandboxed `<iframe srcdoc>`.
3. Accept current approach and document the trust boundary; add a test asserting `securityLevel:'strict'` is always passed.

**Recommendation:** Option 1: add DOMPurify as a defense-in-depth layer. The `mermaid.strict` mode is an internal implementation detail of a third-party library; having an independent step makes the guarantee locally auditable.

---

### CONTENT-002

**Severity:** high  
**Title:** MermaidNodeRenderer and WireframeNodeRenderer statically imported — lazy loading defeated

**Description:**  
In `packages/app-browser/src/assistant-content.tsx` lines 2 and 7, `MermaidNodeRenderer` and `WireframeNodeRenderer` are static ES imports. Both modules — and all transitive imports — are bundled into the initial chunk even when the assistant never produces Mermaid or wireframe content. The design intent explicitly requires heavy specialized runtimes to be lazy-loaded. While `mermaid.min.js` itself is deferred via a Vite `?url` import, the React component wrappers are eagerly bundled.

**Options:**
1. Wrap imports using `React.lazy()` and `dynamic import()`, and wrap `ContentDocumentRenderer` in a `Suspense` boundary.
2. Introduce a lazy-renderer factory inside `content-react` that accepts a `() => Promise<ContentNodeRenderer<T>>` thunk and wraps it in `React.lazy` internally.
3. Accept the current behavior and document that only `mermaid.min.js` is lazy-loaded, then add a bundle-size budget check to CI.

**Recommendation:** Option 2: a lazy-renderer factory centralizes the `Suspense`/`lazy` wiring and avoids boilerplate. Option 1 is an acceptable quick fix if the factory abstraction is premature.

---

### CONTENT-003

**Severity:** medium  
**Title:** Module-level mermaid state never reset between test runs — cross-test contamination risk

**Description:**  
In `packages/content-mermaid/src/index.tsx` lines 21–22, `mermaidPromise` and `hasInitializedMermaid` are module-level variables. Because Vitest caches modules between tests, state set in one test persists into subsequent tests. Future tests that clear `window.mermaid` to exercise the script-injection path will observe stale state and produce order-dependent failures.

**Options:**
1. Export a `resetMermaidState()` function and call it in `afterEach`.
2. Encapsulate the mutable state inside a class or factory function — each test instantiates an isolated loader.
3. Add `vi.resetModules()` + dynamic re-import pattern in any test that exercises the script-injection path.

**Recommendation:** Option 2: eliminating module-level globals via a factory makes the code inherently testable. Option 1 is the minimal fix if refactoring is out of scope.

---

### CONTENT-004

**Severity:** medium  
**Title:** ChoicePromptNode renders as interactive-looking list with no interactivity indication

**Description:**  
In `packages/content-react/src/index.tsx` lines 89–98, `ChoicePromptNodeView` renders choices as a plain `<ul>` with no click handlers, disabled state, or visual cue that items are not interactive. The design intent states `ChoicePromptNode` is reserved but not yet interactive. Users who see the rendered choices will likely click them with no feedback. There are no tests for this component.

**Options:**
1. Add a visible "coming soon" badge or visually disable choice items (`opacity`, `pointer-events: none`, `aria-disabled`), and add a test.
2. Remove `ChoicePromptNodeView` from `defaultContentRenderers` entirely so it falls through to a generic code-block fallback until the feature is ready.
3. Add a comment noting the reserved status and add a test asserting the node renders without crashing.

**Recommendation:** Option 2: removing the renderer from defaults is safest for an unfinished feature. Trivially reversible, prevents user confusion. Add Option 3's test regardless.

---

### CONTENT-005

**Severity:** medium  
**Title:** ImageNode renders URLs without protocol validation

> **See also SEC-006** — same issue reported by the security agent.

**Description:**  
In `packages/content-react/src/index.tsx` line 86, `ImageNodeView` renders `<img src={node.url}>` with no URL validation. The `url` field comes from AI-generated markdown without any protocol check at the parse layer. `data:` URIs containing HTML payloads could be used for phishing, and `javascript:` URIs are a theoretical vector in some browser contexts.

**Options:**
1. Add a URL validation helper (allowlist: `https:`, `http:`, `data:image/*`) in `ImageNodeView` before rendering.
2. Sanitize the `url` field in the `asStandaloneImage` helper in `packages/content-markdown/src/index.ts` line 48 at parse time.
3. Add a test asserting that a `javascript:` URL in an image node renders as an empty `src` or placeholder.

**Recommendation:** Option 2: sanitizing at parse time means protection is applied once, centrally, regardless of which renderer is used. Add Option 3 as well.

---

### CONTENT-006

**Severity:** low  
**Title:** Fragment key uses type+index — unnecessary DOM reconciliation during streaming

**Description:**  
In `packages/content-react/src/index.tsx` line 184, document nodes are keyed as `${node.type}-${index}`. During streaming, `parseMarkdownContent` is re-invoked on every update. When a new block is inserted before existing nodes, indices shift, causing React to unmount and remount unchanged nodes. For `MermaidNodeRenderer` this triggers re-rendering and a flash of the code-block fallback.

**Options:**
1. Derive a stable key from node content (fast hash of the node's primary field + type) so React reuses DOM nodes when content is unchanged.
2. Memoize nodes in `ContentDocumentRenderer` so nodes at the same index with identical content are referentially stable.
3. Accept the current behavior as a known streaming limitation with a documenting comment.

**Recommendation:** Option 1: a content-derived key eliminates flicker and redundant Mermaid re-renders. Requires a small hash utility.

---

### CONTENT-007

**Severity:** low  
**Title:** No integration test for mixed node type ordering end-to-end

**Description:**  
The unit tests in `packages/content-markdown/tests/parse-markdown-content.test.ts` cover individual node types but there is no test verifying that a document containing markdown, mermaid, wireframe, table, and image nodes all interleaved produces nodes in the correct sequence through the full pipeline (parse → `ContentDocumentRenderer` → specialized renderers). The integration test in `packages/app-browser/tests/assistant-content.test.tsx` does not cover wireframe at all.

**Options:**
1. Add an integration test in `assistant-content.test.tsx` that parses and renders a document containing all node types interleaved, asserting DOM order matches source order.
2. Add a test in `parse-markdown-content.test.ts` verifying node sequence for a mixed document.
3. Add both: a parser-level order test and a renderer-level DOM order assertion.

**Recommendation:** Option 3: the parser test and renderer test catch different bug classes. Together they provide a full regression guard for the display order preservation requirement.

---

## Edge Backend

### EDGE-001

**Severity:** high  
**Title:** x-ratelimit-reset-* header treated as relative seconds but may be absolute epoch seconds

**Description:**  
In `packages/app-browser/src/runtime/quota-tracker.ts` lines 48–53 and 58–63, `resetAt` is computed as `nowMs + resetReq * 1000`, treating the header value as a relative offset. However, GitHub's API typically uses `x-ratelimit-reset` as a Unix epoch timestamp (absolute seconds). If the header is epoch-based, `resetAt` would be trillions of milliseconds in the future, locking out all requests indefinitely. The tests use small values like `'45'` and `'10'` which only validate the relative interpretation.

**Options:**
1. Verify actual header semantics by inspecting live responses. If epoch-based, change to `resetAt = resetReq * 1000`.
2. Treat small values (< 86400) as relative seconds and large values as absolute epoch seconds — the pattern already used by `parseRetryAfterMs` in `apps/edge/src/lib/rate-limit.ts` lines 13–23.
3. Remove the `resetReq`/`resetTok` computation and fall back to `nowMs + renewalMs` (already the fallback when reset is 0).

**Recommendation:** Option 2 mirrors the existing pattern in `parseRetryAfterMs` and is defensive against both formats. Verify with a real response first (Option 1) before changing behavior.

---

### EDGE-002

**Severity:** high  
**Title:** Proactive RateLimitError caught by recovery logic — potential infinite loop

**Description:**  
In `packages/app-browser/src/runtime/github-models-provider.ts` lines 96–103, when `checkThrottle` returns `shouldThrottle: true` with `waitMs > 1000`, a `RateLimitError` is thrown. This propagates to `AgentRuntime.synthesizeWithRateLimit` which catches all `RateLimitError` instances and retries them. If the quota window has not expired by the time of the retry, `checkThrottle` fires again and creates another `RateLimitError`, which the recovery loop catches again. The only backstop is the 5-minute cap (`MAX_AUTO_RETRY_AFTER_MS = 300_000`).

**Options:**
1. Instead of throwing `RateLimitError` for proactive throttles, sleep inline in `synthesize` before making the request, keeping prevention entirely within the provider.
2. Add a separate error subclass (`ProactiveThrottleError`) so `synthesizeWithRateLimit` can distinguish prevention-triggered errors from real upstream 429s.
3. Cap the prevention backoff at 1000 ms so it always falls into the existing inline `setTimeout` path and never throws.

**Recommendation:** Option 1: the prevention logic already does an inline `await setTimeout` for `waitMs <= 1000` (lines 105–106). Extending that pattern to all throttle cases removes the threshold and avoids misusing the recovery loop entirely.

---

### EDGE-003

**Severity:** medium  
**Title:** Race condition — concurrent requests bypass quota throttling

**Description:**  
In `packages/app-browser/src/runtime/github-models-provider.ts` lines 94–95, `checkThrottle` is called synchronously before `fetch`. `RateLimitQuota` has no in-flight counter, so if two calls to `synthesize` overlap, both read `remaining = 1`, both pass the throttle check, and both fire requests. One will get a 429.

**Options:**
1. Add an `inFlight` counter to `RateLimitQuota`; include it when computing `remaining` in `checkThrottle`.
2. Document the assumption that only one synthesis runs at a time and add a guard in `synthesize` that throws on concurrent calls.
3. Accept as low-risk given the single-tab browser context.

**Recommendation:** Option 2: `executeChatPrompt` already gates sends via `canSendPrompt` (which checks `isRunning`), so true concurrency is already blocked at the UI layer. A short comment and guard assertion is the right trade-off.

---

### EDGE-004

**Severity:** medium  
**Title:** Heuristic backoff cleared unconditionally on any successful response headers

**Description:**  
In `packages/app-browser/src/runtime/quota-tracker.ts` line 72, `updateFromHeaders` sets `this.heuristicBackoffMs = 0` at the end of every call. This means a burst of rapid requests shortly after a 429 would clear the heuristic before the quota window expires, defeating the protective intent.

**Options:**
1. Only clear `heuristicBackoffMs` if the parsed `remaining` is above the soft-throttle threshold.
2. Remove the `this.heuristicBackoffMs = 0` line from `updateFromHeaders` — the heuristic self-clears via `checkHeuristic` once `elapsed > backoffMs` (line 133).
3. Keep current behavior and document that accurate header data intentionally supersedes the heuristic.

**Recommendation:** Option 2: the heuristic expires naturally. Removing the premature reset ensures a genuine 429 followed by a rapid burst doesn't lose its protection.

---

### EDGE-005

**Severity:** medium  
**Title:** Edge /api/models/chat returns unhelpful error for unmapped upstream status codes

**Description:**  
In `apps/edge/src/routes/models.ts` lines 92–97, when a non-429 upstream error arrives with a status not in `UPSTREAM_ERROR_STATUSES` (e.g. 422, 504), the code returns a generic `Upstream error {status}` message with status 502. A 422 (unprocessable entity — common for invalid model parameters) being returned as 502 makes debugging very difficult.

**Options:**
1. Add 422 and 504 to `UPSTREAM_ERROR_STATUSES` with appropriate messages and pass through with appropriate status codes.
2. For the 503 case, forward the upstream `Retry-After` header to the client just as done for 429.
3. Add a catch-all mapping any 4xx upstream to a 400 and any 5xx to a 502.

**Recommendation:** Options 1 + 2 together. 422 is particularly important for the models endpoint since invalid model names are a common operator mistake.

---

### EDGE-006

**Severity:** medium  
**Title:** No edge tests for 429 response shape or Retry-After header forwarding

**Description:**  
`apps/edge/src/index.test.ts` covers auth failure (401), CORS, and streaming success but has zero tests for the 429 code path. There are no tests verifying: (a) response body conforms to `rateLimitPayloadSchema`, (b) `Retry-After` header is forwarded, (c) `retryAt` ISO string is computed correctly. The `parseRetryAfterMs` function in `apps/edge/src/lib/rate-limit.ts` has no unit tests at all.

**Options:**
1. Add a test in `apps/edge/src/index.test.ts` that stubs `fetch` to return a 429 with `Retry-After: 120` and verifies the edge response status, body shape, and header.
2. Add a separate `rate-limit.test.ts` in `apps/edge/src/lib/` with unit tests for `parseRetryAfterMs` and `toRateLimitResponse`.
3. Add both.

**Recommendation:** Option 3: the parser test and the integration test catch different classes of bugs. The edge's `parseRetryAfterMs` shares identical logic with the browser's version (EDGE-007), so unit tests are especially valuable to ensure the two stay in sync.

---

### EDGE-007

**Severity:** medium  
**Title:** parseRetryAfterMs duplicated between edge and browser packages

**Description:**  
`parseRetryAfterMs` appears character-for-character identically in both `apps/edge/src/lib/rate-limit.ts` (lines 5–25) and `packages/app-browser/src/runtime/rate-limit.ts` (lines 3–23). The recent "deduplicate" refactor moved cooldown UI logic to `app-core` but did not consolidate this parsing function. If the two copies diverge, rate-limit timing will be inconsistent between edge and browser.

**Options:**
1. Move `parseRetryAfterMs` into `packages/app-core/src/` and export it from both packages.
2. Move it into `packages/contracts/src/index.ts` alongside `rateLimitPayloadSchema`.
3. Add a CI check that flags identical function bodies across packages.

**Recommendation:** Option 1: `app-core` is already the shared runtime layer. The edge worker can import from `@tinytinkerer/app-core` to close the duplication gap.

---

### EDGE-008

**Severity:** low  
**Title:** modelsCache never expires — stale model list after token rotation or GitHub model changes

**Description:**  
In `packages/app-browser/src/github-models.ts` lines 24–44, `modelsCache` is a module-level `Map` that is never cleared and never expires. If GitHub adds or removes models, users will not see the update until they reload. Old tokens leave inaccessible but accumulating entries.

**Options:**
1. Add a TTL: store `{ models, cachedAt }` and return `null` if `Date.now() - cachedAt > 5 * 60_000`, forcing a refresh.
2. Key the cache only on `edgeBaseUrl` (not the token) and clear the entry when the auth store's token changes.
3. Keep current behavior but cap the map size (evict oldest entry when `size > 10`).

**Recommendation:** Option 1: simplest fix, avoids stale model lists in long tab sessions.

---

### EDGE-009

**Severity:** low  
**Title:** cors.ts Vary: Origin logic is correct but unclear

**Description:**  
In `apps/edge/src/lib/cors.ts` lines 92–95, `Vary: Origin` is appended when `allowedOrigin !== '*'`. This is technically correct per the CORS spec — but the condition is non-obvious and the logic becomes harder to audit as the file grows.

**Options:**
1. No change — add a comment explaining why `Vary` is set even when the origin is rejected.
2. Simplify: always set `Vary: Origin` unconditionally (harmless with wildcard) and remove the guard.
3. Refactor: `if (configuredOrigins.length > 0) headers.append('Vary', 'Origin')`.

**Recommendation:** Option 1: current logic is correct. A brief comment is the only improvement needed.

---

### EDGE-010

**Severity:** low  
**Title:** fetchWithTimeout silently drops caller's AbortSignal

**Description:**  
In `apps/edge/src/lib/fetch.ts` lines 1–9, `fetchWithTimeout` creates its own `AbortController` and spreads `init` into the fetch options with `signal: controller.signal`, silently overwriting any `signal` passed in `init`. No current callers pass a signal, but the API design is misleading and will break if anyone tries to add cancellation support.

**Options:**
1. Accept an optional `signal` parameter separately and combine with `AbortSignal.any([controller.signal, signal])`.
2. Document in a JSDoc comment that `init.signal` is ignored and only timeout-based cancellation is supported.
3. Rename to `fetchWithTimeoutOnly` to make the limitation explicit.

**Recommendation:** Option 1: `AbortSignal.any` is supported in Cloudflare Workers runtime. Important if future routes need to respect incoming request cancellation.
