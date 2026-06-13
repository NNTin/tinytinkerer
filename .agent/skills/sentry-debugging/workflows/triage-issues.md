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

   **Then segment by environment before investigating anything** (multi-environment
   setup — full SOP: `triage-by-environment.md`). For each issue, get its
   `environment` tag distribution and confirm whether any production events exist:
   ```
   get_issue_tag_values({ organizationSlug, regionUrl, issueId: "<ID>", tagKey: "environment" })
   search_issue_events({ organizationSlug, regionUrl, issueId: "<ID>",
                         query: "!environment:development !environment:pr-preview",
                         statsPeriod: "30d" })
   ```
   Zero `production`/`develop` events ⇒ `pr-preview` or localhost/E2E **noise** —
   resolve with the env evidence (env tag, `http://localhost` url, HeadlessChrome,
   a non-deployed `release` SHA), don't chase a root cause. Has `production` **or
   `develop`** ⇒ real production bug (equal priority — both are live tiers). Edge
   `develop` events may originate from PR-preview traffic (it reuses the develop
   edge); the frontend tags it `pr-preview` — correlate via the shared 7-char SHA
   release to tell them apart. Remember the asymmetry: **frontend has 4 envs, edge
   has 2.**

4. **For each issue, get details and read the `handled` tag.**
   ```
   get_sentry_resource({ url: "https://nntin-labs.sentry.io/issues/<ISSUE-ID>" })
   ```
   Note: `handled` (no = crash / yes = caught), `environment`, last-seen time, culprit, stacktrace file:line. Use `get_issue_tag_values(..., tagKey: "release")` to see which releases it occurs in.

   **First, split a conflated request issue (before deciding anything).** Captured request errors all re-throw through the same `normalizeError` frame (`request-telemetry.ts:60`), so one issue ID can hide *several distinct failures* across endpoints and statuses (`EDGE-4` mixed `GET /v1/models 429`, `POST /inference/chat/completions 429`, and a chat `401` under one id). The title/top event is only *one* of them. Enumerate the real failures by tag first:
   ```
   search_issue_events({ organizationSlug, regionUrl, issueId: "<ISSUE-ID>",
                         query: "environment:production", statsPeriod: "7d", limit: 50 })
   ```
   Read each event's `title` / `request_area` / `http_method` / `http_status` / `path` / `release`. Each distinct `(request_area + http_status)` is a separate problem that may need a *different* fix (a cacheable-list 429 vs a non-cacheable-chat 429 — see step 5). Triage and resolve per-group, and when you resolve the shared issue, state **which** underlying failures you addressed and which (if any) remain.
   > New events now carry a per-`(request_area + failure_kind + http_status)` fingerprint, so they split into separate issues going forward — but any issue created before that still conflates; keep splitting it by tag.

5. **Decide — branch on `handled` and nature:**

   - **`handled: no` (unhandled crash)** → a real bug. Investigate the stacktrace; identify root cause + file/line. Fix it in code.
     - *Exception — normal & unavoidable* (e.g. `AbortError: The operation was aborted` = client disconnected / timed out). These shouldn't be captured at all. Fix = declare `accept: { kinds: ['abort'], reason }` at the call site (see `accept-error.md`) — per-call-site, since an abort can be a real bug elsewhere; don't blanket-filter at `beforeSend`. Until accepted, `ignore` with a reason.
     - *React DOM crash* — stacktrace entirely in `react-dom` (`removeChild`/`insertBefore` `NotFoundError`, "not a child of this node"). Don't `accept` it (that path is for `handled: yes` request telemetry only). Follow `diagnose-react-dom-crash.md` — usually an external DOM mutator (browser translation), fixed via `translate="no"` on the shell.

   - **`handled: yes` (caught & reported, e.g. via `request-telemetry.ts`)** → don't just close it. Ask *why the request failed* — this is the **accept-or-fix fork** (see `../SKILL.md`): fix the call site when the caller misbehaved, or `accept` the outcome in code when it's normal & unavoidable.
     - `401` / auth → caller hit an authenticated endpoint it couldn't satisfy. Gate the call site on
       auth **validity, not just presence**: a persisted-but-expired token still probes and 401s, so
       gating on "is a token set?" alone isn't enough (this is why `FRONTEND-4` regressed). On a 401,
       remember the token as known-bad and stop re-probing it, and dedupe concurrent callers so the
       same stale token is probed once, not once per surface (`github-user.ts`).
     - `429` / rate limit → caller ignored rate-limit headers. Fix depends on **whether the upstream
       is cacheable** (the 429 taxonomy):
       - **cacheable** (the model *catalogue*, `models.list`) → caching gap, never `accept`: cache the
         response durably + serve last-known on 429.
       - **non-cacheable** (LLM *completions*, `models.chat`) → can't cache; durable Retry-After
         backoff + graceful client cooldown + `accept` the residual 429. The backoff does **not**
         suppress the call that *opens* each window — that first 429 still hits upstream and is
         captured — so the call-site `accept: { status: [429] }` is mandatory, not optional (the
         window-opener residual; see `../SKILL.md` trap #3). The cacheable side's analogue is the
         cold-cache-miss (`EDGE-5`).
       Either way the backoff window must be **durable across isolates** (Cache API, not a per-isolate
       `let`). See `../SKILL.md` 429 guidance and the cascade pattern in `correlate-trace.md`. If the
       issue is **REGRESSED**, a prior fix didn't hold → `regressed-issue.md` before reapplying.
     - **Harden sibling call sites together.** One `request_area` often has more than one upstream
       call site (e.g. `models.chat` = a DECIDE call *and* a SYNTHESIZE call in
       `litellm-provider.ts`); a fix on one leaves the other firing the identical error. When a
       "fixed" request error reappears, grep the provider/route for **all** call sites of that area and
       fix them as a set; the stacktrace's first-party frame (`synthesizeInner` vs `streamDecision`)
       tells you which one fired. Full procedure in `regressed-issue.md` (Sibling call sites).
     - **Sibling call sites cross the project boundary too (cross-boundary relocation).** A single
       hop (browser → edge → third-party) has a call site on *each* side, and hardening one side only
       fixes that side. After the edge `models.list` call site was hardened (cache + serve-last-known
       / graceful 503), the SAME failure resurfaced one hop downstream at the FRONTEND caller of
       `/api/models/list` (`app-browser/src/models.ts`), which still captured the edge's 429/503
       — the issue hopped `EDGE-4`/`EDGE-5` → `FRONTEND-C`/`FRONTEND-D`, same `request_area`, same
       trace. **Each project calling a cacheable resource needs its own graceful handling:** the edge
       serves-last-known / 503; the frontend caches-last-known *and* accepts the edge's cooldown status
       (see the cacheable fork in `../SKILL.md` and `correlate-trace.md`, cross-boundary relocation).
     - `502` / upstream → check whether it's our edge API crashing (correlate with an edge issue / `trace` id) vs. a transient upstream vs. an edge status-mapping bug. **Follow `correlate-trace.md`** to decide which. Fix the real cause; don't blanket-catch.
     - `Failed to fetch` (network/CORS) → check the target host; may be user network (unavoidable) or a real CORS/config bug.

6. **Apply the resolution** with `update_issue` (always include `reason`):

   | Situation | Status |
   |---|---|
   | Fixed in code this session (fix not yet deployed) | `resolvedInNextRelease` |
   | Already fixed in the live production release (step 2), only old events remain | `resolved` |
   | Stale: not seen in the current prod release and not worth fixing | `resolved` (reason: stale / superseded) |
   | Normal & unavoidable — accepted in code this session (see `accept-error.md`) | `resolvedInNextRelease` (reason: accepted in code at `<file>`) |
   | Normal & unavoidable, but a code change isn't possible this session | `ignored` (reason: why it's expected) — stopgap; accept it in code next |
   | Real bug, unfixed this session | leave `unresolved` — **report it to the user**, don't close |

   ```
   update_issue({ organizationSlug, regionUrl, issueId: "<ISSUE-ID>",
                  status: "resolvedInNextRelease",
                  reason: "Fixed call site to gate /user fetch on auth state (commit <sha>)." })
   ```

7. **Report.** Summarize per issue: status set + why, and list any real bugs left unresolved that need a code fix.

## Notes / breadcrumbs

- `resolvedInNextRelease` is preferred over plain `resolved` for fresh fixes: Sentry auto-reopens (escalates) the issue if it recurs after the fix ships, so a bad fix doesn't silently stay "resolved". **Quirk:** the `tinytinkerer-frontend` project has no "next release" association, so an `update_issue(status: "resolvedInNextRelease")` on a frontend issue is **coerced to plain `resolved`** (the edge project keeps `resolvedInNextRelease`). Either way Sentry auto-regresses a `resolved` issue when matching events recur on a newer release, so escalation still holds — just don't be surprised the frontend status reads `resolved`. Pass `reason` regardless; a `Fixes <ISSUE>` line in the PR also auto-closes on merge.
- To confirm a fix landed: after the next prod deploy, re-run step 3 — the issue should not reappear in `release:<new-sha>`.
- Correlating a frontend 5xx to its edge crash (vs. an upstream/status-mapping bug) via trace id is captured as its own SOP: `correlate-trace.md`. Found another repeatable sub-procedure? Capture it as a new SOP in this folder.
- An issue with `substatus: regressed` (a fix that reopened on a newer release) has its own SOP: `regressed-issue.md` — find why the prior fix failed instead of reapplying it.
