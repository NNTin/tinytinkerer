# Sentry Telemetry (SDK-agnostic core)

`@tinytinkerer/sentry-telemetry` (`packages/shared/sentry-telemetry`) is the shared
error-telemetry engine used by **both** the browser shells and the edge backend. It carries
**no Sentry SDK runtime dependency** — only type-level imports from `@sentry/core`.

## Why a shared core instead of one Sentry setup

The two runtimes run on different Sentry SDKs that cannot share an init path:

- **Browser** (`@tinytinkerer/app-browser`) uses `@sentry/react`, initialized **lazily** only
  after the user grants telemetry consent, and is careful to keep the contracts/zod barrel and
  `@sentry/react` out of the eager bundle.
- **Edge** (`@tinytinkerer/edge`) uses `@sentry/cloudflare` via `Sentry.withSentry(...)`,
  initialized eagerly from Cloudflare `env` (needs `nodejs_compat` for `AsyncLocalStorage`).

So unification happens at the **SDK-agnostic** layer. Each app keeps its own `Sentry.init` /
`withSentry`, but both wire in the shared scrubbers and capture sink. Because the package
imports no Sentry runtime, importing it eagerly in the browser adds no `@sentry/react`, and the
lazy-load discipline is preserved.

## What the package owns

- **`scrub.ts` — PII scrubbers.** `scrubEvent` (wire as `beforeSend`) deletes the request body,
  query string, URL query, and auth/cookie headers; `scrubBreadcrumb` (wire as
  `beforeBreadcrumb`) drops non-error console crumbs and strips fetch/xhr URLs. Both are
  generic so the caller's concrete `Event`/`ErrorEvent` type flows through. Previously these
  were hand-duplicated in the browser and edge `beforeSend`. See [PRIVACY.md](./PRIVACY.md).
- **`request-telemetry.ts` — the request engine.** `fetchWithTelemetry`,
  `parseJsonWithTelemetry` / `tryParseJsonWithTelemetry`, `parseWithTelemetry`, and
  `captureRequestIssue`, plus the structured tags/contexts and the **accept** mechanism
  (`RequestTelemetryMetadata.accept`) documented in `.agent/skills/sentry-debugging`.
- **`capture.ts` — the capture sink (IoC).** `captureRequestIssue` dispatches through
  `captureTelemetryException`, which forwards to a sink registered via
  `setCaptureExceptionSink`. This inverts the old dependency (request-telemetry no longer
  imports a browser-only module), making the engine SDK-agnostic.

## How each runtime wires it

Each app registers one sink that maps the SDK-agnostic `{ level, tags, contexts }` onto its
own Sentry scope:

- **Browser** — `packages/app/app-browser/src/telemetry/telemetry.ts` registers a
  `@sentry/react` sink once the SDK initializes (and clears it on consent-off teardown), and
  passes `scrubEvent` / `scrubBreadcrumb` to `Sentry.init`. app-browser **re-exports** the
  request-telemetry surface (via `src/telemetry/request-telemetry.ts`) so its call sites import
  from `@tinytinkerer/app-browser` as before — app-browser remains the single browser boundary.
  **Environment gate:** `ensureSentry` never initializes Sentry for the `development`
  environment (localhost, the default when `VITE_SENTRY_ENVIRONMENT` is unset), even if a DSN
  leaks into the local env and consent is granted. Localhost / E2E errors are never production
  signal — sending them only pollutes the shared Sentry projects' triage list and burns quota.
  Deployed builds set `production` / `develop` / `pr-preview` explicitly and report normally.
- **Edge** — `apps/edge/src/lib/sentry.ts` registers a `@sentry/cloudflare` sink at module
  load; `apps/edge/src/index.ts` passes `scrubEvent` as `beforeSend`; and
  `apps/edge/src/lib/fetch.ts` (`fetchWithTimeout`) now routes outbound calls (GitHub Models,
  OAuth exchange, Tavily search) through `fetchWithTelemetry`, so the edge captures upstream
  4xx/5xx and network failures with the same `request_area` / `http_status` / `failure_kind`
  tags as the browser.

## Dependency boundaries

`sentry-telemetry` is a leaf: it may import only `@sentry/core` (external) and its own local
modules. `@tinytinkerer/edge` and `@tinytinkerer/app-browser` may depend on it. These rules are
enforced by `scripts/check-boundaries.mjs`.
