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

3. **Read the result across projects:**
   - A `tinytinkerer-edge` row with **`handled: no`** in the trace ⇒ **our edge crashed**. Open it
     (`get_sentry_resource`) for the stacktrace and fix the edge bug.
   - **No** `tinytinkerer-edge` error in the trace at all ⇒ the edge did **not** crash; it returned
     the status on purpose. That points to an **edge status-mapping bug** (the route turned an
     upstream status into the wrong client status) or a faithfully-reported **transient upstream**.
     Read the edge route (`apps/edge/src/routes/…`, see `sourceRoot` in `sentry-context.mjs`) to
     tell which.

4. **Cross-check sibling errors by timestamp.** Errors a few seconds apart in the same trace often
   share one root cause. Worked example (`FRONTEND-5`): trace `eddac972…` held a `429` chat
   (`react.decide`) and a `502` list (`models.list`) seconds apart, and **zero** edge errors — so
   the `502` was the `models.list` route mapping an upstream `429` to `502` during one rate-limit
   storm, not a crash and not a flaky upstream.

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
