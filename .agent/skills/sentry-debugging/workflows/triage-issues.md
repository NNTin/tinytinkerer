# Workflow: Triage production issues

Goal: turn the unresolved Sentry list into honest signal — real bugs identified, fixed-and-shipped issues closed, stale noise cleared, each change justified.

Read the **Triage philosophy** in `../SKILL.md` before deciding statuses.

## Steps

1. **Load connection constants.**
   ```bash
   node .agent/skills/sentry-debugging/tools/sentry-context.mjs
   ```
   Use `organizationSlug` + `regionUrl` from the output on every MCP call.

2. **Find the live production release.** Releases are git short SHAs.
   ```
   find_releases({ organizationSlug, regionUrl, projectSlug: "tinytinkerer-edge" })
   ```
   Take the most recent release whose **Last Deploy → Environment** is `vercel-production`. Note its SHA — that is what production is running. (`tinytinkerer-frontend` shares the same release SHAs.) Note the env mismatch: the release deploy label is `vercel-production`, but events tag `environment: production` — use `environment:production` when filtering issues.

3. **List unresolved issues, per project, by frequency.**
   ```
   search_issues({ organizationSlug, regionUrl, projectSlugOrId: "<project>",
                   query: "is:unresolved", sort: "freq" })
   ```
   Run for both `tinytinkerer-edge` and `tinytinkerer-frontend`.

4. **For each issue, get details and read the `handled` tag.**
   ```
   get_sentry_resource({ url: "https://nntin-labs.sentry.io/issues/<ISSUE-ID>" })
   ```
   Note: `handled` (no = crash / yes = caught), `environment`, last-seen time, culprit, stacktrace file:line. Use `get_issue_tag_values(..., tagKey: "release")` to see which releases it occurs in.

5. **Decide — branch on `handled` and nature:**

   - **`handled: no` (unhandled crash)** → a real bug. Investigate the stacktrace; identify root cause + file/line. Fix it in code.
     - *Exception — normal & unavoidable* (e.g. `AbortError: The operation was aborted` = client disconnected / timed out). These shouldn't be captured at all. Fix = filter them out at the SDK/`beforeSend` level, not a logic change. Until filtered, `ignore` with a reason.

   - **`handled: yes` (caught & reported, e.g. via `request-telemetry.ts`)** → don't just close it. Ask *why the request failed*:
     - `401` / auth → caller hit an authenticated endpoint while unauthenticated. Fix the call site to gate on auth state.
     - `429` / rate limit → caller ignored rate-limit headers. Fix to back off / respect them.
     - `502` / upstream → check whether it's our edge API crashing (correlate with an edge issue / `trace` id) vs. a transient upstream. Fix the real cause; don't blanket-catch.
     - `Failed to fetch` (network/CORS) → check the target host; may be user network (unavoidable) or a real CORS/config bug.

6. **Apply the resolution** with `update_issue` (always include `reason`):

   | Situation | Status |
   |---|---|
   | Fixed in code this session (fix not yet deployed) | `resolvedInNextRelease` |
   | Already fixed in the live production release (step 2), only old events remain | `resolved` |
   | Stale: not seen in the current prod release and not worth fixing | `resolved` (reason: stale / superseded) |
   | Normal & unavoidable, can't yet be filtered | `ignored` (reason: why it's expected) |
   | Real bug, unfixed this session | leave `unresolved` — **report it to the user**, don't close |

   ```
   update_issue({ organizationSlug, regionUrl, issueId: "<ISSUE-ID>",
                  status: "resolvedInNextRelease",
                  reason: "Fixed call site to gate /user fetch on auth state (commit <sha>)." })
   ```

7. **Report.** Summarize per issue: status set + why, and list any real bugs left unresolved that need a code fix.

## Notes / breadcrumbs

- `resolvedInNextRelease` is preferred over plain `resolved` for fresh fixes: Sentry auto-reopens (escalates) the issue if it recurs after the fix ships, so a bad fix doesn't silently stay "resolved".
- To confirm a fix landed: after the next prod deploy, re-run step 3 — the issue should not reappear in `release:<new-sha>`.
- Found a repeatable sub-procedure (e.g. correlating a frontend 502 to its edge crash via trace id)? Capture it as its own SOP in this folder.
