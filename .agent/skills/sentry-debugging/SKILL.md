# sentry-debugging

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
  - **Triage:** `update_issue` (resolve / resolveInNextRelease / unresolve / ignore / assign).
  - **Docs:** `search_docs`, `get_doc`.

## Triage philosophy (how to decide, not just how to click)
- **`handled` tag is the pivot.** `handled: no` = an unhandled crash → a real bug; fix the root cause, don't just close it. `handled: yes` = an error our code caught and reported (e.g. frontend `request-telemetry.ts`).
- **Prevent the faulty request in the first place.** Don't call an authenticated endpoint while unauthenticated; respect rate-limit headers. A 401/429 in Sentry usually means the *caller* should have known better. Fix the call site, not the symptom. See **the accept-or-fix guideline** below for the fork.
- **A general catch is bad.** Swallowing errors hides bugs. Let errors surface so we see and fix them. Only genuinely *normal and unavoidable* events (e.g. client-aborted requests) should avoid being reported — for those, *accept* them in code (see below), don't wrap call sites in try/catch.
- **Resolve against a release.** Once fixed in code, mark `resolvedInNextRelease` so the issue auto-reopens (escalates) if it recurs after the fix ships. Only mark plain `resolved` if it is already fixed in the live production release. Close clearly stale issues.
- **Leave a breadcrumb.** Always pass `reason` to `update_issue` — it posts to the issue's activity feed.

## The accept-or-fix guideline (tinytinkerer)
Every outbound browser request funnels through `fetchWithTelemetry` / `parse*WithTelemetry` in `packages/app/app-browser/src/telemetry/request-telemetry.ts`. **By design it captures every failure** — that's the point: we collect real production signal so future agents fix the *caller* (respect rate-limit headers, gate on auth) instead of tripping the rate limit again. Do not add try/catch to silence these.

When you triage a `handled: yes` request issue, you hit a fork:

- **Fix the call site** (the default). The failure means the caller misbehaved: `401` from an unauthenticated probe, `429` from ignoring rate-limit headers, `5xx` from our own edge bug. The error is signal — eliminate the bad request.
- **Accept the outcome.** The failure is the normal, unavoidable result of a *correct* call and will never be a bug — a user cancelling a streaming chat (`abort`), an existence check that legitimately `404`s. Declare it accepted **in code** at the call site so it is never captured.

**How to accept:** add an `accept` block to that call site's `RequestTelemetryMetadata`:
```ts
accept: { status: [404], kinds: ['abort'], reason: '<why it is normal & unavoidable + Sentry issue id>' }
```
`status` and `kinds` are both optional; `reason` is **required** by the type. If you can't write a one-line reason, it's a bug — fix the call site instead. Accept specific statuses/kinds only; never blanket a whole call site. Full procedure: `workflows/accept-error.md`.

**Why in code, not Sentry `ignore`:** `ignore` only hides the issue in the dashboard — the event is still *sent* every time, still counts against quota, and can still trip rate limits. The tinytinkerer rule is **prevent the report at the source**. `ignore` is a stopgap; the code `accept` is the real fix. After adding an `accept`, resolve the Sentry issue (`resolvedInNextRelease`) with a `reason` naming the call site.

## Constraints
- Always pass `organizationSlug: nntin-labs` and `regionUrl: https://de.sentry.io`.
- Two projects only: `tinytinkerer-edge`, `tinytinkerer-frontend`.
- Never blanket-resolve. Each status change needs a justification (fixed where / why ignored).
- Don't fabricate fixes to close issues — if it's a real bug and unfixed, report it; don't resolve it.
- If MCP is down, abort.

## Success criteria
The unresolved list reflects reality: real bugs are investigated (root cause + file/line identified, or fixed and `resolvedInNextRelease`), stale/already-shipped issues are `resolved`, and every status change carries a `reason`. New SOPs are captured under `workflows/` when you solve something repeatable.
