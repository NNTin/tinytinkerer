# Workflow: Segment issues by environment (multi-environment triage)

Goal: separate **real production bugs** from develop / pr-preview / localhost noise
*before* you spend effort on root cause. The two Sentry projects do **not** share
the same environment set, and a single user action can produce events tagged
differently on each tier — so an issue's title tells you nothing about which tier
it came from. Always segment first.

Read `docs/vercel-deployment.md` §7 (Sentry Environments) once; the asymmetry
below is the part that bites.

## The environment map (the asymmetry that bites)

| Tier | Frontend env tag | Edge env tag |
|---|---|---|
| Production (`main`) | `production` | `production` |
| Develop (`develop`) | `develop` | `develop` |
| **PR preview** (pull requests) | `pr-preview` | **`develop`** ← reuses the develop edge |
| Local dev (localhost) | `development` | (local wrangler; not in the shared prod projects) |

- **Frontend = 4 environments** (`production`, `develop`, `pr-preview`,
  `development`). **Edge = 2** (`production`, `develop`) — each worker tags events
  by *which worker served them*, and there is no separate preview worker.
- **PR-preview traffic hits the DEVELOP edge.** So a bug triggered from a PR
  preview shows as `pr-preview` on the frontend but `develop` on the edge. When
  you see an edge `develop` error, it may have originated from a PR preview, not
  the develop branch — don't assume.
- **`development` = localhost** (default when `VITE_SENTRY_ENVIRONMENT` is unset;
  url `http://localhost:3111/...`, often `HeadlessChrome` from E2E). This is pure
  noise. As of session/tin-41 the frontend no longer initializes Sentry for
  `development` (`telemetry.ts` `ensureSentry` gate), so it should stop appearing —
  if you still see fresh `development` events, that gate regressed or a non-web
  surface bypasses it.

## Steps

1. **Run the context tool** — it now prints the `environments` block (the table
   above as data).
   ```bash
   node .agent/skills/sentry-debugging/tools/sentry-context.mjs
   ```

2. **For every unresolved issue, get its environment distribution _first_.**
   ```
   get_issue_tag_values({ organizationSlug, regionUrl, issueId: "<ID>", tagKey: "environment" })
   ```
   This is faster than reading events and immediately tells you whether the issue
   is production signal or noise.

3. **Confirm whether any production events exist** (don't trust a single top
   value — an issue can mix tiers):
   ```
   search_issue_events({ organizationSlug, regionUrl, issueId: "<ID>",
                         query: "!environment:development", statsPeriod: "30d" })
   ```
   - **Zero non-`development` events** → localhost/E2E noise. Resolve with a reason
     naming the environment evidence (env tag, `http://localhost` url, HeadlessChrome,
     a `release` SHA that isn't a deployed release). Don't chase a root cause.
   - **Has `production` events** → real production bug. This is the priority;
     triage per `triage-issues.md` (handled fork, accept-or-fix).
   - **Only `develop` / `pr-preview`** → lower priority than production, but still
     real signal. A `develop` *edge* issue may be PR-preview traffic — see step 4.

4. **Correlate cross-tier / cross-project via the release SHA.** The release stays
   the **7-char git SHA** across all environments and both projects (source maps
   shared). To tie a `develop` edge error to the PR preview that caused it:
   - take the frontend event (tagged `pr-preview`) and read its `release` SHA;
   - find edge events on the same `release:<sha>` (`get_issue_tag_values(tagKey:"release")`
     or `search_issue_events query:"release:<sha>"`).
   A shared `trace` id often does **not** span both projects (see
   `correlate-trace.md`), so the **SHA release is the reliable cross-tier key**, not
   the trace.

5. **Resolve / report per the table in `triage-issues.md` step 6.** When you
   resolve a noise issue, the reason must name the environment evidence so the next
   agent doesn't re-investigate it as a production bug.

## Gotchas captured here

- **`get_issue_tag_values` "Total Unique Values: N" can over-count** (it has echoed
  the event count). Trust the per-value `Count` column and the step-3
  `!environment:development` event search, not the "unique values" headline.
- **The `vercel-production` / `vercel-preview` labels are release *deploy* labels**
  from the (to-be-disabled) Vercel↔Sentry integration — **not** event environment
  tags. Filter issues by the event tag `environment:production`; use the
  `vercel-production` deploy only to identify the live release SHA. Once the Vercel
  integration is disabled (docs §7), those deploy labels go away but the
  `environment:*` event tags (set in code) remain authoritative.
