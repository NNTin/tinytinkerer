# Workflow: Correlate a frontend failure to its root cause via trace id

Goal: given a frontend `5xx` (or other edge-origin) failure that carries a `trace_id`, decide
**which** of these it is, so you fix the real cause instead of guessing:

- **Our edge crashed** — an unhandled error in the edge route (`handled: no`, surfaced by Hono's
  error handler). → fix the edge bug.
- **Edge status-mapping / passthrough bug** — the edge returned the status *deliberately* but
  wrongly (e.g. it mapped an upstream `429` to a `502`). → fix the edge route's mapping.
- **Transient upstream** — the upstream (GitHub Models, Tavily, …) genuinely failed and the edge
  reported it faithfully. → usually accept or leave; not our bug.

Read the **accept-or-fix guideline** in `../SKILL.md` first. This SOP is the `502 / upstream`
branch of `triage-issues.md` step 5.

## Steps

1. **Get the `trace_id`.** It's in the issue's `trace` context from
   `get_sentry_resource({ url: "https://nntin-labs.sentry.io/issues/<ISSUE-ID>" })` (look for
   `trace.trace_id`).

2. **Enumerate every error in that trace, across both projects.**
   ```
   search_events({
     organizationSlug: "nntin-labs", regionUrl: "https://de.sentry.io",
     dataset: "errors",
     query: "trace:<trace_id>",
     fields: ["title","project","http_status","request_area","request_origin","handled","timestamp"],
     sort: "-timestamp"
   })
   ```
   > Gotcha: `get_sentry_resource(resourceType: 'trace', ...)` can fail with a transient Sentry API
   > error. `search_events` with `query: "trace:<id>"` is the reliable way to list the trace's
   > errors — use it as the primary tool here.
   >
   > Bigger gotcha: **the trace often does NOT span both projects.** Trace context isn't propagated
   > across the frontend→edge boundary here, so a frontend failure and the edge failure it triggered
   > usually carry **different `trace_id`s** — a `trace:<id>` search returns only *one* project's error.
   > When that happens, don't conclude "the edge didn't error"; fall through to step 4 and correlate by
   > **`request_area` + `http_status` + timestamp** instead (see the cross-project note there).

3. **Read the result across projects:**
   - A `tinytinkerer-edge` row with **`handled: no`** in the trace ⇒ **our edge crashed**. Open it
     (`get_sentry_resource`) for the stacktrace and fix the edge bug.
   - **No** `tinytinkerer-edge` error in the trace at all ⇒ **either** the edge did not crash (it
     returned the status on purpose — an **edge status-mapping bug** or a faithfully-reported
     **transient upstream**), **or** the edge *did* error but in a **separate trace** (propagation gap,
     see step 2). Disambiguate with step 4 before concluding: an edge error matching the frontend's
     `request_area` + `http_status` at the same second means the edge was involved despite the
     different `trace_id`. Read the edge route (`apps/edge/src/routes/…`, see `sourceRoot` in
     `sentry-context.mjs`) to tell a mapping bug from a faithful passthrough.

4. **Cross-check sibling errors by timestamp.** Errors a few seconds apart in the same trace often
   share one root cause. Worked example (`FRONTEND-5`): trace `eddac972…` held a `429` chat
   (`react.decide`) and a `502` list (`models.list`) seconds apart, and **zero** edge errors — so
   the `502` was the `models.list` route mapping an upstream `429` to `502` during one rate-limit
   storm, not a crash and not a flaky upstream.

   **Cross-project correlation when the trace doesn't span both projects (the common case).** Trace
   propagation across frontend→edge is absent (step 2), so match the two projects' errors by their
   **shared tags + timestamp** instead of a shared `trace_id`. Two errors are the *same cascade* when
   they share **`request_area`** and **`http_status`** and fired within ~1–2s of each other — one in
   `tinytinkerer-frontend` (`request_origin: edge`, the symptom) and one in `tinytinkerer-edge`
   (`request_origin: <third-party>`, the source). Enumerate each project's recent matching errors:
   ```
   search_events({ organizationSlug, regionUrl, dataset: "errors",
     query: "request_area:models.list http_status:429",
     fields: ["title","project","http_status","request_area","request_origin","handled","release","timestamp"],
     sort: "-timestamp" })
   ```

   ### Recognising an upstream-429 cascade (third-party rate limit → edge → frontend)
   Signature (`EDGE-4` / `FRONTEND-5`, same `models.list` 429s at `21:28:47`, **different** trace_ids):
   - **frontend** `http_error` `http_status:429`, `request_area:models.list`, `request_origin:edge`
     (browser → our edge `GET /api/models/list`) — the **symptom**.
   - **edge** `http_error` `http_status:429`, same `request_area`, `request_origin:github`, request
     `host: models.github.ai` (`GET /v1/models`) — the **source**: a third-party (GitHub Models)
     rate limit the edge captured and propagated downstream.
   This is **not** an edge crash and **not** a status-mapping bug — the edge faithfully forwarded a
   429. How you fix it depends on **whether the upstream is cacheable** (the 429 taxonomy):
   - **`models.list` → `GET /v1/models` (cacheable catalogue):** identical for every caller, changes
     rarely → **fix, not accept**: durable, cross-request caching + Retry-After / serve-last-known at
     the edge call site (`apps/edge/src/routes/models.ts` + `lib/models-cache.ts`).
   - **`models.chat` → `POST /inference/chat/completions` (non-cacheable completions):** the response
     is unique per prompt, so there is nothing to cache. The 429 cascades the *same* way (frontend
     `react.decide` `request_origin:edge` 429 ⇐ edge `models.chat` `request_origin:github` 429 against
     `models.github.ai`, seconds apart, different trace_ids), but the fix differs: **durable
     Retry-After backoff** (short-circuit while the window is open) **+ a graceful client cooldown**
     (the frontend turns the 429 into a `RateLimitError` → cooldown banner) **+ `accept` the residual
     429** (the unavoidable first call that opens each window) at both the edge `models.chat` fetch and
     the frontend `runtime/edge-fetch.ts`. This is the `FRONTEND-9` / `EDGE-4`-chat cascade.

   Either way the backoff window must be **durable across isolates** — a per-isolate module `let`
   resets on every fresh Cloudflare isolate and won't actually stop the hammering (use
   `apps/edge/src/lib/rate-limit.ts` `getActiveBackoffMs` / `recordBackoff`, backed by the Cache API).
   If the issue is **REGRESSED**, the previous attempt didn't hold — follow `regressed-issue.md`
   before reapplying anything.

   > Inspecting an event: `get_sentry_resource` already returns the **most-relevant frame and the full
   > stacktrace inline** — no extra call. When the tags + stacktrace don't explain *why* a request
   > fired (e.g. a refetch loop), pull `get_sentry_resource(resourceType: 'breadcrumbs', ...)` for the
   > preceding fetch/navigation/console sequence.

5. **Verify the release before deciding fix-vs-stale.** Check the offending events' `release` tag
   against the current prod release (`triage-issues.md` step 2). Task framing can be wrong — in the
   `FRONTEND-5` session, `EDGE-2`/`EDGE-3` were on *older* releases than stated and were stale, not
   live bugs.

## Notes

- This only tells you *where* the status came from; the accept-or-fix decision still follows
  `../SKILL.md`. A confirmed edge crash or status-mapping bug is **fix the call site**; a faithfully
  reported, normal upstream outcome may be **accept**.
- Remember `accept` can't silence an edge `handled: no` crash — see `accept-error.md`
  ("When `accept` does NOT apply").
