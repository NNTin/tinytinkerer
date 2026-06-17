# Developer Diagnostics (nostics)

This repo uses [`nostics`](https://github.com/vercel-labs/nostics) as a **developer-facing diagnostics DX layer**. It turns ad-hoc `console.error('...')` / `throw new Error('...')` strings into stable, **code-named** diagnostics that carry a `why`, an actionable `fix`, an optional `cause`, source locations, and a link back to this page.

> **It is a local-development convenience, not a production error contract.**
> In production the **edge error contract** (`edgeErrorResponseSchema` in
> `@tinytinkerer/contracts`) and **Sentry telemetry** (`@tinytinkerer/sentry-telemetry`)
> remain the single source of truth. nostics never replaces them — see
> [sentry-telemetry.md](./sentry-telemetry.md).

## Dev-only and strippable by design

`@nostics/unplugin`'s **strip transform** is wired into **every browser shell's vite config** (`apps/web`, `apps/mobile`, `apps/widget` — all three consume the shared `@tinytinkerer/app-browser` and all three deploy via `build:pages`) as `nosticsStrip.vite()`, every build. It:

- marks `defineDiagnostics()` and the reporter factories `/*#__PURE__*/`, and
- wraps every **report-only** diagnostic call site in a `process.env.NODE_ENV !== 'production'` guard.

So in a production `build:pages` bundle, **report-only diagnostics and their reporters tree-shake out completely** — verified by building `apps/web` and grepping `dist` for the diagnostic code, `why`/`fix` text, and the `nostics:report` collector channel (all absent). The reporters are _additionally_ gated on `import.meta.env.DEV`, so no dev machinery ships even when a diagnostic is `throw`n (a thrown `Diagnostic` is a real `Error` and is intentionally kept; its reporters are not).

In **dev** (`vite serve`):

- a **console reporter** prints the formatted diagnostic to the browser console, and
- a **dev reporter** forwards each diagnostic over the Vite dev-server socket to `nosticsCollector` (in each shell's vite config, serve-only), which appends it as NDJSON to that shell's `.nostics.log` (e.g. `apps/web/.nostics.log`; the host dev server runs a separate Vite server per shell using its own config, so the log lands under whichever shell you exercised). All gitignored. Read it with `node .agent/skills/nostics/tools/read-diagnostics.mjs` (it searches every shell).

## Where things live

| Piece                                                      | Location                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Code definitions (`defineDiagnostics`)                     | `packages/app/app-browser/src/diagnostics.ts` (the one foundation module) |
| Strip transform + dev collector wiring                     | `apps/{web,mobile,widget}/vite.config.ts`                                 |
| Agent skill (define a code, read diagnostics, when to use) | `.agent/skills/nostics/`                                                  |
| Version waiver (age gate)                                  | `pnpm-workspace.yaml` (`minimumReleaseAgeExclude`, time-boxed)            |

To add a code, follow `.agent/skills/nostics/workflows/define-a-diagnostic.md`. Keep this page's per-code sections in sync — the `docsBase` link points each code at its `###` heading below (lowercased code name).

## Diagnostic codes

### TT_CONTENT_RENDER_TELEMETRY_WIRING_FAILED

- **Where:** `packages/app/app-browser/src/app.ts`, during browser-app initialization.
- **Why:** the content-render error reporter could not be wired (the dynamic import of `@tinytinkerer/content-react` / `setContentRenderErrorReporter` failed), so content render failures will not be forwarded to Sentry for this session.
- **Fix:** confirm `@tinytinkerer/content-react` resolves and exports `setContentRenderErrorReporter`. Startup intentionally continues without the sink — this is **non-fatal**.
- **Mode:** report-only (stripped from production builds). In production the failure is silent here by design; Sentry remains the source of truth.
