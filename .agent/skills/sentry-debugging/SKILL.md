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
- **Prevent the faulty request in the first place.** Don't call an authenticated endpoint while unauthenticated; respect rate-limit headers. A 401/429 in Sentry usually means the *caller* should have known better. Fix the call site, not the symptom.
- **A general catch is bad.** Swallowing errors hides bugs. Let errors surface so we see and fix them. Only genuinely *normal and unavoidable* events (e.g. client-aborted requests) should avoid throwing — for those the fix is to stop capturing them, not to wrap code in try/catch.
- **Resolve against a release.** Once fixed in code, mark `resolvedInNextRelease` so the issue auto-reopens (escalates) if it recurs after the fix ships. Only mark plain `resolved` if it is already fixed in the live production release. Close clearly stale issues.
- **Leave a breadcrumb.** Always pass `reason` to `update_issue` — it posts to the issue's activity feed.

## Constraints
- Always pass `organizationSlug: nntin-labs` and `regionUrl: https://de.sentry.io`.
- Two projects only: `tinytinkerer-edge`, `tinytinkerer-frontend`.
- Never blanket-resolve. Each status change needs a justification (fixed where / why ignored).
- Don't fabricate fixes to close issues — if it's a real bug and unfixed, report it; don't resolve it.
- If MCP is down, abort.

## Success criteria
The unresolved list reflects reality: real bugs are investigated (root cause + file/line identified, or fixed and `resolvedInNextRelease`), stale/already-shipped issues are `resolved`, and every status change carries a `reason`. New SOPs are captured under `workflows/` when you solve something repeatable.
