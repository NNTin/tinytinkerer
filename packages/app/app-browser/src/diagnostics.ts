import { createConsoleReporter, defineDiagnostics } from 'nostics'
import { createDevReporter } from 'nostics/reporters/dev'

// ---------------------------------------------------------------------------
// Developer-facing diagnostics (nostics)
// ---------------------------------------------------------------------------
// This module is the single foundation for structured, code-named developer
// diagnostics in the browser shells. Each code carries a stable name plus typed
// `why` / `fix` builders, an optional `cause`, source locations, and a docs
// link — replacing ad-hoc `console.error('...')` / `throw new Error('...')`
// strings with something an agent (or a human) can grep, look up, and act on.
//
// DEV-ONLY / STRIPPABLE — this is a DX layer, NOT a production error contract:
//   * The reporters below are gated on `import.meta.env.DEV`, so they never run
//     in a production build.
//   * `@nostics/unplugin`'s strip transform (wired into apps/web/vite.config.ts)
//     marks `defineDiagnostics()` and the reporter factories `/*#__PURE__*/` and
//     wraps every *report-only* diagnostic call site in a
//     `process.env.NODE_ENV !== 'production'` guard, so report-only diagnostics
//     and their reporters tree-shake completely out of `build:pages`.
//   * In PRODUCTION the edge error contract (`edgeErrorResponseSchema`) and
//     Sentry telemetry remain the source of truth. Diagnostics are purely a
//     local-development convenience and must never be relied on at runtime in
//     prod. See docs/diagnostics.md and the `nostics` agent skill.
//
// Reporters (dev only):
//   * console reporter — prints the formatted diagnostic to the browser console.
//   * dev reporter — forwards each diagnostic over the Vite dev-server socket so
//     `nosticsCollector` (apps/web/vite.config.ts) appends it to `.nostics.log`,
//     where an agent can read it.
export const diagnostics = defineDiagnostics({
  docsBase: (code) =>
    `https://github.com/NNTin/tinytinkerer/blob/develop/docs/diagnostics.md#${String(
      code
    ).toLowerCase()}`,
  reporters: import.meta.env.DEV ? [createConsoleReporter(), createDevReporter()] : [],
  codes: {
    // Raised when the content-render error reporter cannot be wired during
    // startup. Non-fatal: the app continues without the Sentry content-render
    // sink. Reported (not thrown) so it strips from production builds.
    TT_CONTENT_RENDER_TELEMETRY_WIRING_FAILED: {
      why: (params: { module: string }) =>
        `Failed to wire the content-render error reporter from "${params.module}". ` +
        `Content render failures will not be forwarded to Sentry for this session.`,
      fix: (params: { module: string }) =>
        `Confirm "${params.module}" resolves and exports setContentRenderErrorReporter. ` +
        `Startup intentionally continues without the sink — this is non-fatal.`
    }
  }
})
