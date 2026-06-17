# Workflow: Accept a normal & unavoidable error in code

Goal: stop a `handled: yes` request failure that is the _normal, unavoidable result of a correct call_ from being captured — at the source, in code, not via Sentry `ignore` (which still sends the event and burns quota). Read the **accept-or-fix guideline** in `../SKILL.md` first.

Use this only when the failure is genuinely not a bug and never will be (user-cancelled stream → `abort`, an existence check that legitimately `404`s). If the failure means the _caller_ misbehaved (`401` unauthenticated, `429` ignored rate-limit headers, `5xx` our edge bug), **don't accept it** — fix the call site per `triage-issues.md`.

**The one legitimate 5xx accept (self-emitted cooldown).** A 5xx is _usually_ a real bug, with one exception: when our OWN edge **deliberately** emits a `503 + Retry-After` (or a residual `429`) as a _designed cooldown / cache-miss signal for a cacheable resource_ — e.g. `/api/models/list`, where the edge serves last-known or a graceful 503 while GitHub Models is rate limited — the downstream caller (`app-browser/src/models.ts`) must `accept` that **specific** status for that **specific** `request_area` and serve its cached list. That self-emitted cooldown is by-design, not a server-down crash. This is narrow: accept only the exact status your edge is contracted to emit, for that one area (`accept: { status: [429, 503] }`) — never blanket-accept 5xx. It settled `FRONTEND-C`/`FRONTEND-D` (the cross-boundary relocation of the hardened edge `models.list`; see `correlate-trace.md`).

## When `accept` does NOT apply (edge `handled:no` crashes)

The `accept` gate lives in `captureRequestIssue` and only suppresses the **`handled:yes`** telemetry capture. On the **edge**, an error that escapes a route handler is _also_ captured a second time by Hono's error handler as **`handled:no`** (`mechanism: auto.faas.hono.error_handler`) — and an `accept` block does **nothing** for that path. So a `handled:no` edge `AbortError` (client disconnect / upstream timeout, e.g. `EDGE-2`/`EDGE-3`) is **not** fixable with `accept`. The fix there is **route-level**: catch the abort in the route and return a benign response so it never reaches Hono. Reserve `accept` for the `handled:yes` request-telemetry captures (the frontend `fetchWithTelemetry` path and the edge upstream `fetchWithTimeout` path _when the error is swallowed by the caller, not rethrown past the route_).

## Steps

1. **Confirm it's normal & unavoidable.** Write the one-line reason out loud. If you can't, it's a bug — stop and fix the call site instead.

2. **Find the call site.** Use the Sentry issue's `request_area` + `request_origin` tags and the stacktrace to locate the `RequestTelemetryMetadata` it was built from. The source root depends on the project (see `sourceRoot` in `sentry-context.mjs`): **frontend** (`tinytinkerer-frontend`) call sites live under `packages/app/app-browser/src/` (e.g. `request_area: models.chat` → `runtime/litellm-provider.ts`); **edge** (`tinytinkerer-edge`) call sites live under `apps/edge/src/` (e.g. the `models.chat`/`models.list` upstream fetches → `routes/models.ts`, built for `lib/fetch.ts`'s `fetchWithTimeout`). The shared telemetry engine itself is in `packages/shared/sentry-telemetry/src/`.

3. **Declare the acceptance.** Add an `accept` block to that site's metadata. Accept specific statuses/kinds only — never blanket the whole call site.

   ```ts
   const metadata: RequestTelemetryMetadata = {
     area: 'models.chat',
     origin: 'edge',
     method: 'POST',
     url: `${baseUrl}/api/models/chat`,
     accept: {
       kinds: ['abort'], // and/or status: [404]
       reason: 'User can cancel an in-flight chat stream; AbortError is expected (#<issue-id>).'
     }
   }
   ```

   `kinds` must be values from the `RequestTelemetryKind` union — `abort`, `network_error`, `http_error`, `parse_error`, `schema_error` (match the issue's `failure_kind` tag). See the kind table in `../SKILL.md`. Common cases: `kinds: ['abort']` for a user-cancellable stream; `kinds: ['network_error']` for a background poll to our edge or a third-party host that can transiently fail (e.g. `status.health` → `shell.ts`, `github.user` → `github-user.ts`). Accepting one kind still captures the rest, so a real `http_error` (e.g. a `401`/`5xx`) keeps surfacing.

   The gate lives in `captureRequestIssue` (`request-telemetry.ts`) — every failure kind and both call paths funnel through it, so one `accept` covers `fetchWithTelemetry` and the `parse*WithTelemetry` helpers for that metadata.

4. **Prove it with a test.** Two test homes:
   - **Engine behaviour** (a kind/status is honoured at all): `packages/shared/sentry-telemetry/tests/request-telemetry.test.ts` — the engine moved to the shared `@tinytinkerer/sentry-telemetry` package. Run `pnpm --filter @tinytinkerer/sentry-telemetry test`.
   - **Call-site behaviour** (this metadata accepts this kind): the call site's own test, e.g. `packages/app/app-browser/tests/github-user.test.ts`. Run `pnpm --filter @tinytinkerer/app-browser test`.

   With the `accept` block, the accepted status/kind must leave the capture sink **uncalled**; a non-accepted outcome on the same call must still capture once.

5. **Resolve the Sentry issue.** `update_issue(... status: "resolvedInNextRelease", reason: "Accepted in code at <file> — <accept.reason>")`. It auto-reopens if the _non-accepted_ part ever recurs.

## Notes

- Per-call-site, not global: the same kind (e.g. `abort`) can be expected at one site and a real bug at another. Accept where you have the context, never at `beforeSend`.
- `accept` suppresses _reporting_ only — control flow is unchanged: `fetchWithTelemetry` still returns the response / re-throws the error, so call-site fallback logic keeps working.
