# Workflow: Accept a normal & unavoidable error in code

Goal: stop a `handled: yes` request failure that is the *normal, unavoidable result of a correct call* from being captured — at the source, in code, not via Sentry `ignore` (which still sends the event and burns quota). Read the **accept-or-fix guideline** in `../SKILL.md` first.

Use this only when the failure is genuinely not a bug and never will be (user-cancelled stream → `abort`, an existence check that legitimately `404`s). If the failure means the *caller* misbehaved (`401` unauthenticated, `429` ignored rate-limit headers, `5xx` our edge bug), **don't accept it** — fix the call site per `triage-issues.md`.

## Steps

1. **Confirm it's normal & unavoidable.** Write the one-line reason out loud. If you can't, it's a bug — stop and fix the call site instead.

2. **Find the call site.** Use the Sentry issue's `request_area` + `request_origin` tags and the stacktrace to locate the `RequestTelemetryMetadata` it was built from (all live under `packages/app/app-browser/src/`). Example: `request_area: models.chat` → `runtime/github-models-provider.ts`.

3. **Declare the acceptance.** Add an `accept` block to that site's metadata. Accept specific statuses/kinds only — never blanket the whole call site.
   ```ts
   const metadata: RequestTelemetryMetadata = {
     area: 'models.chat',
     origin: 'edge',
     method: 'POST',
     url: `${baseUrl}/api/models/chat`,
     accept: {
       kinds: ['abort'],                 // and/or status: [404]
       reason: 'User can cancel an in-flight chat stream; AbortError is expected (#<issue-id>).'
     }
   }
   ```
   The gate lives in `captureRequestIssue` (`telemetry/request-telemetry.ts`) — every failure kind and both call paths funnel through it, so one `accept` covers `fetchWithTelemetry` and the `parse*WithTelemetry` helpers for that metadata.

4. **Prove it with a test.** Add/extend a case in `packages/app/app-browser/tests/request-telemetry.test.ts`: with the `accept` block, the accepted status/kind must leave `captureTelemetryException` **uncalled**; a non-accepted outcome on the same call must still capture once. Run `pnpm --filter @tinytinkerer/app-browser test`.

5. **Resolve the Sentry issue.** `update_issue(... status: "resolvedInNextRelease", reason: "Accepted in code at <file> — <accept.reason>")`. It auto-reopens if the *non-accepted* part ever recurs.

## Notes

- Per-call-site, not global: the same kind (e.g. `abort`) can be expected at one site and a real bug at another. Accept where you have the context, never at `beforeSend`.
- `accept` suppresses *reporting* only — control flow is unchanged: `fetchWithTelemetry` still returns the response / re-throws the error, so call-site fallback logic keeps working.
