/**
 * Which document-global effects a `BrowserApp` owns (issue #479).
 *
 * Everything a `BrowserApp` does is per-instance — its own stores, its own
 * IndexedDB namespace, its own auth — with the exception of the handful of
 * effects listed here, which write to state there is only ONE of per document:
 * the `<head>`, the telemetry module's configuration/consent/install identity,
 * the content-render error sink, and a boot-time window timer.
 *
 * With one `BrowserApp` per document that distinction never mattered, so
 * `initializeBrowserApp` simply did all of it. #479 puts a second app in the
 * same document (the docs assistant beside the docs live labs), and then it
 * matters a great deal: the LAST app to boot would otherwise win the telemetry
 * configuration and install identity, and — worse — restore ITS OWN persisted
 * `telemetryEnabled` over a choice the other app's user just made.
 *
 * So ownership becomes explicit. Exactly one app in a document should own each
 * of these; every other app passes `false` and keeps its per-instance
 * initialization (auth, settings, plugin reconciliation) untouched.
 *
 * The default is "owns everything", which is what a single-app document
 * (apps/host, apps/shell, apps/canvas, apps/mermaid, apps/ide) wants and what
 * every existing caller already got.
 */
export type DocumentGlobalCapabilities = {
  /**
   * Upsert the TinyTinkerer brand `<link>`/`<meta>` set (favicon, manifest,
   * theme-color) into `document.head`.
   *
   * Disabled by BOTH docs apps: Docusaurus owns the documentation site's head,
   * manifest, icons, and theme color, and a second managed `theme-color`
   * competing with its own is not something an embedded assistant should add.
   */
  brandMetadata: boolean
  /**
   * Configure the telemetry module (DSN/environment/release), publish the
   * pseudonymous install identity, restore persisted consent at boot, and act
   * as the consent controller — i.e. be the app whose `setTelemetryEnabled`
   * reaches module-global consent and whose settings UI offers the toggle.
   *
   * These travel together deliberately. Consent, configuration, and identity
   * are three writers to the same module state (`telemetry/telemetry.ts`), and
   * splitting them would let one app configure telemetry that another app's
   * setting silently switches on.
   */
  telemetry: boolean
  /** Register the content-render error reporter (one module-global sink). */
  contentRenderReporter: boolean
  /** Arm the boot-time OAuth callback watchdog (one 10s timer per boot). */
  oauthCallbackWatchdog: boolean
}

export const DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES: DocumentGlobalCapabilities = {
  brandMetadata: true,
  telemetry: true,
  contentRenderReporter: true,
  oauthCallbackWatchdog: true
}

export const resolveDocumentGlobalCapabilities = (
  overrides: Partial<DocumentGlobalCapabilities> = {}
): DocumentGlobalCapabilities => ({ ...DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES, ...overrides })

/**
 * Which single-instance UI hosts a `BrowserAppShell` mounts.
 *
 * Replaces the previous coarse `mountGlobals` boolean, which bundled four
 * unrelated hosts together. #479 needs them separable in both directions: the
 * docs assistant owns the consent/privacy/Konami hosts for the whole
 * documentation site while mounting no human-in-the-loop host at all, because
 * nothing in the documentation build can raise a prompt — plugin discovery is
 * stubbed there and no documentation tool requests human input.
 *
 * That last part is now the WHOLE reason. It used to come with a second one —
 * that the prompt queue was module-global and would misroute between the two
 * docs apps — and #489 has since made the queue one store per `BrowserApp`, so
 * a mounted host can only ever draw its own app's prompts. What remains is
 * simply that mounting a host which can never fire costs every reader a chunk
 * for nothing. See ./human-prompt-bridge.ts.
 *
 * Note this is per-SHELL, not per-app: several `BrowserAppShell`s can share one
 * `BrowserApp` (every `<LiveLab>` on a docs page mounts its own shell over the
 * one shared lab app), so "which shell draws the modal" is a different question
 * from "which app owns the document". Those shells are views of one session and
 * share its queue, deliberately — see human-prompt-bridge.ts's note on
 * multiplicity.
 */
export type GlobalHostCapabilities = {
  humanPrompt: boolean
  telemetryConsent: boolean
  privacyUpdate: boolean
  konami: boolean
}

export const DEFAULT_GLOBAL_HOST_CAPABILITIES: GlobalHostCapabilities = {
  humanPrompt: true,
  telemetryConsent: true,
  privacyUpdate: true,
  konami: true
}

export const NO_GLOBAL_HOST_CAPABILITIES: GlobalHostCapabilities = {
  humanPrompt: false,
  telemetryConsent: false,
  privacyUpdate: false,
  konami: false
}

export const resolveGlobalHostCapabilities = (
  overrides: Partial<GlobalHostCapabilities> = {}
): GlobalHostCapabilities => ({ ...DEFAULT_GLOBAL_HOST_CAPABILITIES, ...overrides })
