# sentry-debugging

<!-- BEGIN GENERATED: .agent/README.md — do not edit; run `pnpm sync:skill-readme`

# `.agent` — WAT skills (Workflow · Agent · Tools)

Skills the agent uses to work in this repo. Core idea: **offload deterministic steps to scripts so you stay focused on decisions.** Chained 90%-accurate manual steps decay fast (0.9^5 ≈ 59%) — scripts don't drift, and they save tokens.

## Skill layout

```
.agent/skills/<skill-name>/
  SKILL.md      # when to use, how, available tools, constraints, success criteria
  workflows/    # markdown SOPs (step-by-step procedures)
  tools/        # deterministic scripts the workflows call
```

## How you (the agent) work

1. Match the task to a skill, read its `SKILL.md`.
2. Scan workflow **filenames** for a relevant SOP — don't read every file.
3. Follow the SOP; run the tool scripts instead of doing the steps by hand.
4. **Self-evolve:** if you solved something repeatable the hard way, capture it as a new workflow SOP (+ tool). Future agents thank you.

END GENERATED: .agent/README.md -->

Investigate and triage production errors via the **Sentry MCP**. Read `../../README.md` first for the WAT framework.

The MCP gives you ~27 tools across three groups: **inspect** issues & events, read **docs**, and **triage** (resolve/ignore/assign). This skill tells you which to reach for, in what order, and how to decide.

## When to use
- Someone asks "what's broken in prod?", "are there new errors?", or to investigate a specific Sentry issue.
- After shipping a fix, to confirm the issue stopped and close it.
- Routine triage: keep the unresolved list honest (resolve fixed, close stale, surface real bugs).

## How
1. Get connection constants — `node .agent/skills/sentry-debugging/tools/sentry-context.mjs`. Pass `organizationSlug` + `regionUrl` on **every** MCP call (the org is `nntin-labs`, not `tinytinkerer`).
2. Scan `workflows/` filenames for the matching SOP and follow it. Start with `workflows/triage-issues.md`.
3. If the MCP returns auth/connection errors, **abort and tell the user** — they will re-set it up. Do not work around it.

## Available tools
- `tools/sentry-context.mjs` — prints org slug, region URL, project slugs, and the production environment name. Run it instead of guessing connection params.
- Sentry MCP (load schemas via ToolSearch `select:<name>` before calling):
  - **Inspect:** `find_organizations`, `find_projects`, `find_releases`, `search_issues`, `search_events`, `search_issue_events`, `get_sentry_resource`, `get_issue_tag_values`, `whoami`.
    - `get_sentry_resource` returns the **most-relevant frame + full stacktrace inline** for an issue/event — no extra call. It also fetches other resource types via `resourceType`: **`breadcrumbs`** (the fetch/navigation/console sequence *before* the error — use it when tags + stacktrace don't explain *why* a request fired), **`trace`** (span tree; but see `correlate-trace.md` — a trace often doesn't span both projects), and **`replay`**.
  - **Triage:** `update_issue` (resolve / resolveInNextRelease / unresolve / ignore / assign).
  - **Docs:** `search_docs`, `get_doc`.

## Three recurring traps (read before triaging a request issue)
1. **One issue ID can hide several failures (conflation).** Every captured request error is re-thrown through the same `normalizeError` frame (`packages/shared/sentry-telemetry/src/request-telemetry.ts:60`), so Sentry's default grouping collapses *unrelated* endpoints and statuses into a single issue — e.g. `EDGE-4` mixed `GET /v1/models (429)`, `POST /inference/chat/completions (429)`, and a chat `401`. **Never trust an issue's title as the whole story.** Split it first with `search_issue_events` + the `request_area` / `http_status` / `path` tags (worked procedure in `triage-issues.md`). The capture now sets a **per-`(request_area + failure_kind + http_status)` fingerprint** (`buildRequestFingerprint` in `request-telemetry.ts`, applied via `scope.setFingerprint` in both sinks), so *new* events split into distinct issues — but pre-fingerprint issues are still conflated; keep splitting them by tag.
2. **A "fixed" issue that returns or moves (regression / relocation).** A resolved 401/429 reopens, or hops to a sibling endpoint (the 429 went list→chat; the 401 came back on a newer release). `substatus: regressed` means the last fix didn't hold — find the gap, don't reapply. Dedicated SOP: `regressed-issue.md`. **Relocation crosses the project boundary too:** hardening a resource on *one* side of a hop only fixes that side's call site — the SAME failure can resurface at the caller on the *other* side. Hardening the EDGE `models.list` call site (cache + serve-last-known/503) left the FRONTEND caller of `/api/models/list` still capturing the edge's 429/503, so the issue hopped edge→frontend (`EDGE-4`/`EDGE-5` → `FRONTEND-C`/`FRONTEND-D`). Each project that calls a cacheable resource needs its **own** graceful handling. See `correlate-trace.md` (cross-boundary relocation).
3. **Not all 429s are fixed the same way (429 taxonomy).** A 429 on a **cacheable** upstream (the model *catalogue*, `models.list`) → durable cache + serve-last-known. A 429 on a **non-cacheable** upstream (LLM *completions*, `models.chat`) → durable Retry-After backoff + graceful cooldown UX + `accept` the residual. Details in `correlate-trace.md`.
   - **The window-opener residual.** Durable backoff suppresses every call *after* the window opens, but **not the call that opens it** — that first 429 still reaches upstream and is still captured. So **backoff alone never zeroes out the issue**: for a non-cacheable upstream you *must* also `accept: { status: [429] }` at the call site, or the window-opener keeps firing the issue (this is why `FRONTEND-B` lingered after the backoff shipped). The cacheable-side analogue is the **cold-cache-miss**: a fresh isolate with an empty Cache API has nothing to serve, so its one probe is the cacheable window-opener — handle it by serving last-known / a graceful 503 and accepting *that* cold-start probe (not blanket-accepting the cacheable 429); see `EDGE-5`.

## Segment by environment FIRST (multi-environment setup)
The two projects do **not** share the same environment set, and one user action can be tagged differently per tier — so **always check the `environment` tag distribution before investigating an issue**. Full SOP: `workflows/triage-by-environment.md`.
- **Frontend = 4 envs** (`production`, `develop`, `pr-preview`, `development`). **Edge = 2** (`production`, `develop`) — each worker tags by which worker served the request; there is no preview worker.
- **PR-preview frontend traffic hits the DEVELOP edge** → its edge events are tagged `develop`, NOT `pr-preview`. An edge `develop` error may actually be PR-preview traffic.
- **`development` = localhost** (url `http://localhost:3111/...`, often `HeadlessChrome` E2E, a `release` SHA that isn't a deployed release) = pure noise. The frontend no longer inits Sentry for `development` (`packages/app/app-browser/src/telemetry/telemetry.ts` `ensureSentry` gate) — fresh `development` events mean that gate regressed.
- **Production errors are the priority.** Quick check: `search_issue_events(query: "!environment:development")` — zero results ⇒ localhost noise (resolve with the env evidence, don't chase root cause); has `production` ⇒ real prod bug.
- **Cross-tier / cross-project correlation key is the 7-char git SHA release**, not the trace id (a trace often doesn't span both projects). Same SHA is deployed to develop and production intentionally (shared source maps).

## Triage philosophy (how to decide, not just how to click)
- **`handled` tag is the pivot.** `handled: no` = an unhandled crash → a real bug; fix the root cause, don't just close it. `handled: yes` = an error our code caught and reported (e.g. frontend `request-telemetry.ts`).
  - A `handled: no` crash whose stacktrace is entirely inside `react-dom` (`NotFoundError ... removeChild`, `insertBefore`, "not a child of this node") is its own diagnosis path — often an **external** DOM mutator (browser translation/extension), not our logic. Follow `workflows/diagnose-react-dom-crash.md`.
- **Prevent the faulty request in the first place.** Don't call an authenticated endpoint while unauthenticated; respect rate-limit headers. A 401/429 in Sentry usually means the *caller* should have known better. Fix the call site, not the symptom. See **the accept-or-fix guideline** below for the fork.
- **A general catch is bad.** Swallowing errors hides bugs. Let errors surface so we see and fix them. Only genuinely *normal and unavoidable* events (e.g. client-aborted requests) should avoid being reported — for those, *accept* them in code (see below), don't wrap call sites in try/catch.
- **Resolve against a release.** Once fixed in code, mark `resolvedInNextRelease` so the issue auto-reopens (escalates) if it recurs after the fix ships. Only mark plain `resolved` if it is already fixed in the live production release. Close clearly stale issues.
- **A REGRESSED issue means the last fix didn't hold.** `substatus: regressed` (or the `is:regressed` filter) on an issue you previously resolved is a signal, not noise: it auto-reopened because it recurred on a newer release. **Don't reapply the old fix** — find why it failed first. Follow `workflows/regressed-issue.md`.
- **Leave a breadcrumb.** Always pass `reason` to `update_issue` — it posts to the issue's activity feed.

## The accept-or-fix guideline (tinytinkerer)
Every outbound request — browser *and* edge — funnels through `fetchWithTelemetry` / `parse*WithTelemetry`, the shared engine in `packages/shared/sentry-telemetry/src/request-telemetry.ts` (the frontend re-exports it via `app-browser/src/telemetry/request-telemetry.ts`; the edge calls it through `apps/edge/src/lib/fetch.ts`). **By design it captures every failure** — that's the point: we collect real production signal so future agents fix the *caller* (respect rate-limit headers, gate on auth) instead of tripping the rate limit again. Do not add try/catch to silence these.

When you triage a `handled: yes` request issue, you hit a fork:

- **Fix the call site** (the default). The failure means the caller misbehaved: `401` from an unauthenticated probe, `429` from ignoring rate-limit headers, `5xx` from our own edge bug. The error is signal — eliminate the bad request.
  - **`429` — first ask: is the upstream *cacheable*?** (the 429 taxonomy, trap #3). This fork decides the fix:
    - **Cacheable upstream** (the GitHub Models *catalogue*, `models.list` → `GET /v1/models`) → never `accept` the *upstream* 429. Fix = **cache the upstream response durably at the call site + honour `Retry-After` / serve the last-known value on a 429** so we stop re-probing and tripping the limit (`apps/edge/src/lib/models-cache.ts`). **But this is two call sites across a hop:** the edge caches GitHub's catalogue *and serves a graceful 503 + Retry-After (or last-known) downstream during cooldown*; the FRONTEND caller of `/api/models/list` (`app-browser/src/github-models.ts`) must *mirror* this — cache its own last-known list and, because the edge's 503/429 here is a **designed cooldown signal for a cacheable resource** (not a server-down bug), `accept: { status: [429, 503] }` for *that one area* and serve the cached list. Skipping the frontend side relocates the issue edge→frontend (`FRONTEND-C`/`FRONTEND-D`). This is the one legitimate self-emitted-5xx accept — see the `http_error` kind below.
    - **Non-cacheable upstream** (LLM *completions*, `models.chat` → `POST /inference/chat/completions`; the response is unique per prompt, nothing to cache) → you can't cache it away. Fix = **durable Retry-After backoff** (short-circuit the upstream while its window is open) **+ a graceful client cooldown** (the frontend turns the 429 into a `RateLimitError` → cooldown banner, not a captured error) **+ `accept` the residual 429** at the call site — the unavoidable window-opener (see trap #3); backoff does *not* retroactively suppress it, so this `accept` is mandatory, not optional. Apply it at **every** chat call site: the edge `models.chat` fetch (`apps/edge/src/routes/models.ts`), and on the frontend **both** the DECIDE path (`runtime/edge-fetch.ts`) **and** the SYNTHESIZE path (`runtime/github-models-provider.ts` `synthesizeInner` — a *separate* inline metadata, missed in the first round → `FRONTEND-B`). All carry `accept: { status: [429] }`.
    - **Either way the backoff window must be durable.** **Cloudflare gotcha:** a `let`/module-level backoff is **per-isolate** and resets on every fresh Worker isolate — it is *not* durable and won't actually stop the hammering (this is how the `models.list` 429s REGRESSED after PR #100, and why the `models.chat` 429s kept firing even after the list was cached). Use the **Cache API (`caches.default`)**, which persists across requests and isolates within a colo (`apps/edge/src/lib/rate-limit.ts` `getActiveBackoffMs` / `recordBackoff` / `clearBackoff`; the list catalogue cache is `models-cache.ts`). **Types gotcha:** the edge has no `@cloudflare/workers-types`, so `caches.default` (and `ExecutionContext`) aren't on the DOM `CacheStorage` type — reach them via a narrow cast and feature-detect so the code no-ops under vitest. Full cascade recognition + the regression angle: `workflows/correlate-trace.md` and `workflows/regressed-issue.md`.
- **Accept the outcome.** The failure is the normal, unavoidable result of a *correct* call and will never be a bug — a user cancelling a streaming chat (`abort`), an existence check that legitimately `404`s. Declare it accepted **in code** at the call site so it is never captured.

**How to accept:** add an `accept` block to that call site's `RequestTelemetryMetadata`:
```ts
accept: { status: [404], kinds: ['network_error'], reason: '<why it is normal & unavoidable + Sentry issue id>' }
```
`status` and `kinds` are both optional; `reason` is **required** by the type. If you can't write a one-line reason, it's a bug — fix the call site instead. Accept specific statuses/kinds only; never blanket a whole call site. Full procedure: `workflows/accept-error.md`.

**The exact `kinds` values** (the `RequestTelemetryKind` union in `packages/shared/sentry-telemetry/src/request-telemetry.ts`) — match the issue's `failure_kind` tag:
- `abort` — request cancelled (`AbortError`); user cancelled a stream, or a timeout fired.
- `network_error` — `fetch` rejected before any response (offline, DNS, CORS, TLS, third-party host down). The Sentry title looks like `TypeError: Failed to fetch (<host>)`.
- `http_error` — a response arrived but `!response.ok` (4xx/5xx). **Rarely accept this** — a 5xx from our own edge is *usually* a real bug; prefer fixing or accepting a specific `status:` instead. **The one legitimate 5xx accept:** when our OWN edge *deliberately* emits a `503 + Retry-After` (or a residual `429`) as a **designed cooldown / cache-miss signal for a cacheable resource** — e.g. `models.list`, where the edge serves last-known or a graceful 503 while GitHub Models is rate limited — the downstream caller must `accept` that **specific** status for that **specific** `request_area` and serve its cached data. That self-emitted cooldown is by-design, not a server-down crash, so it adds no signal (`FRONTEND-C`/`FRONTEND-D` at `github-models.ts`). This is narrow and distinct from "a 5xx is usually a real bug": accept only the exact status your edge is contracted to emit, for that one area — never blanket-accept 5xx.
- `parse_error` — response body wasn't valid JSON.
- `schema_error` — body parsed but failed our shape validation.

Accept `abort`/`network_error` for *background or user-cancellable* calls where a transient client-side failure is expected and not our bug. Accepting one kind still captures the others — e.g. `kinds: ['network_error']` on a GitHub fetch leaves a real `401` (an `http_error`) reported.

**Why in code, not Sentry `ignore`:** `ignore` only hides the issue in the dashboard — the event is still *sent* every time, still counts against quota, and can still trip rate limits. The tinytinkerer rule is **prevent the report at the source**. `ignore` is a stopgap; the code `accept` is the real fix. After adding an `accept`, resolve the Sentry issue (`resolvedInNextRelease`) with a `reason` naming the call site.

## Constraints
- Always pass `organizationSlug: nntin-labs` and `regionUrl: https://de.sentry.io`.
- Two projects only: `tinytinkerer-edge`, `tinytinkerer-frontend`.
- Never blanket-resolve. Each status change needs a justification (fixed where / why ignored).
- Don't fabricate fixes to close issues — if it's a real bug and unfixed, report it; don't resolve it.
- If MCP is down, abort.

## Success criteria
The unresolved list reflects reality: real bugs are investigated (root cause + file/line identified, or fixed and `resolvedInNextRelease`), stale/already-shipped issues are `resolved`, and every status change carries a `reason`. New SOPs are captured under `workflows/` when you solve something repeatable.
