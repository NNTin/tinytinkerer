# Workflow: Diagnose a REGRESSED issue (a prior fix that didn't hold)

Goal: given an issue you (or a past agent) previously **resolved** that has reopened, find **why the
earlier fix failed on the current release** and close the real gap — instead of blindly reapplying
the same approach and watching it regress again.

A REGRESSED issue is Sentry telling you a hypothesis was wrong: a `resolvedInNextRelease` /
`resolved` issue auto-reopened because matching events recurred on a **newer** release than the one
that resolved it. Read the **Triage philosophy** in `../SKILL.md` first.

## The signature (how to spot it)

- `get_sentry_resource({ url: ".../issues/<ID>" })` shows **`Substatus: regressed`** (the issue list
  also supports the `is:regressed` filter).
- `get_issue_tag_values(..., tagKey: "release")` shows the issue occurring on a release **newer than**
  the one named in the resolving activity/commit — i.e. it came back *after* the "fix" shipped, not
  just leftover old events.
- The issue's **activity feed** has a prior resolve with a `reason` breadcrumb (we always leave one),
  and/or a `Fixes <ISSUE>` commit — your starting point for "what was tried."

If the only events are on the **old** release (at/older than the resolving SHA), it's not a real
regression — those are stragglers; it can go back to `resolved` (stale). Confirm the live release per
`triage-issues.md` step 2 before deciding.

## Steps

1. **Confirm it actually regressed.** Cross-check `substatus: regressed` against the `release` tag
   distribution and the live prod release. New events on the current SHA ⇒ genuine regression →
   continue. Only old-release events ⇒ stale, not a regression → `resolved` (reason: stragglers).

2. **Recover what the prior fix did.** Read the resolving PR/commit and the issue's `reason`
   breadcrumb:
   ```bash
   git log --oneline --all | grep -i "<area / issue id>"      # find the resolving commit/PR
   git show <sha> -- <files it touched>                        # see the actual change
   ```
   Name the **mechanism** the old fix relied on (a cache, a guard, a header check, a backoff window …).

3. **Find the gap — why that mechanism doesn't hold on the current release.** Test the old mechanism
   against how the code actually runs in prod. Common failure modes:
   - **Runtime-lifecycle wrong.** State the fix assumed was durable isn't. *Worked example
     (`EDGE-4`/`FRONTEND-5`):* PR #100's rate-limit backoff lived in a **module-level `let`** — durable
     in a long-lived server, but Cloudflare Workers spin up **many ephemeral isolates**, each starting
     with the window reset to zero, so it never actually stopped re-probing GitHub Models. It also
     added **no positive caching** of the cacheable catalogue. → real fix: a **cross-isolate Cache API**
     cache (see `../SKILL.md` 429 guidance).
   - **Fix bypassed.** A new/different call site doesn't go through the guard.
   - **Fix ineffective / wrong layer.** It treated the symptom (e.g. status remapping) not the cause
     (the upstream call itself).
   - **Shipped but not deployed**, or behind config that's off in prod.

4. **Fix the real gap, with a test that would have caught the regression.** Don't reapply the old
   approach. Add a test that fails on the old mechanism and passes on the new one (e.g. "second call
   serves from a durable cache without re-probing upstream").

5. **Resolve `resolvedInNextRelease` with a breadcrumb that names the gap.** Because it regressed once
   already, a release-aware resolution matters — it re-escalates if the *new* fix also fails to hold.
   ```
   update_issue({ organizationSlug, regionUrl, issueId: "<ID>",
                  status: "resolvedInNextRelease",
                  reason: "Regression root cause: <old mechanism> didn't hold because <gap>. Fixed at <file> with <new approach> (Fixes <ISSUE>)." })
   ```

## Notes

- If you genuinely can't pin why it regressed, **leave it `unresolved` and report it** — a second
  fabricated fix is worse than an open issue (see `../SKILL.md`: don't blanket-resolve).
- A fix that regresses a second time after `resolvedInNextRelease` is the honest signal your new
  hypothesis is also wrong — re-enter step 3 and look one layer deeper (runtime, deploy, config).
- This is the regression counterpart to `correlate-trace.md`: correlate first to confirm *what* the
  cascade is, then come here to learn *why the last attempt to stop it failed*.
