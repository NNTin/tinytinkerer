/**
 * The one global documentation-assistant `BrowserApp` (issue #479).
 *
 * The locked P6 design: a SEPARATE docs-assistant singleton built from the same
 * bootstrap as the docs live labs, never the live-lab instance itself.
 * `BrowserApp` owns one chat/settings state and one app tool group, so reusing
 * the lab's would merge histories and put the Documentation tools inside lab
 * conversations — the isolation this issue exists to establish.
 *
 * Module-level, like the labs' own singleton, because Docusaurus keeps
 * `@theme/Root` mounted for the life of the SPA: the assistant has to be the
 * same assistant after a route change, with the same conversation and any
 * in-flight run intact.
 *
 * Only ever reached through a dynamic `import()` (see `AssistantRuntimeHost`),
 * so a documentation page that never activates the assistant downloads none of
 * this.
 */
import { createDocumentationAssistantPolicy } from '../docs-assistant'
import { createDocumentationToolGroup } from '../docs-tools'
import {
  DOCS_ASSISTANT_STARTER_PROMPTS,
  DOCS_ASSISTANT_STORAGE_NAMESPACE
} from './assistant-constants'
import { createDocsBrowserApp, type DocsBrowserApp } from './create-docs-app'
import type { DocsRuntimeConfig } from './runtime-config'

let assistantAppPromise: Promise<DocsBrowserApp> | null = null

export const ensureDocsAssistantApp = (
  runtimeConfig: DocsRuntimeConfig
): Promise<DocsBrowserApp> => {
  assistantAppPromise ??= createDocsBrowserApp({
    storageNamespace: DOCS_ASSISTANT_STORAGE_NAMESPACE,
    runtimeConfig,
    // #477's three documentation tools, attached to THIS session only. They are
    // ordinary tool-picker entries here — enabled by default for the assistant
    // and independently disablable — and absent from every live lab, which
    // carries its own demo group instead.
    //
    // No `getSiteConfig` override: the group's default reads whatever #476 last
    // published, and `DocsPageProvider` is mounted above this host in
    // `@theme/Root`, so the tools see the same site config the page context does.
    appToolGroup: createDocumentationToolGroup(),
    // #478's grounding and citation policy: instructions at every reasoning
    // boundary, the citation ledger, and the render-time link allowlist.
    appAssistantPolicy: createDocumentationAssistantPolicy(),
    starterPrompts: DOCS_ASSISTANT_STARTER_PROMPTS,
    // The assistant owns every document-global effect for the documentation
    // site (issue #479). Structural, not first-claim: this host exists at
    // `@theme/Root` for the whole application, so there is no race to win and no
    // ownership to transfer. Every live lab passes all of these `false`.
    documentGlobals: {
      // ...except the head. Docusaurus owns the site's manifest, icons, and
      // theme color; the assistant adds no second managed `theme-color`.
      brandMetadata: false,
      telemetry: true,
      contentRenderReporter: true,
      oauthCallbackWatchdog: true
    }
  }).catch((error: unknown) => {
    // Clear the memo so a retry can genuinely retry, rather than re-resolving
    // the same rejection for the rest of the session.
    assistantAppPromise = null
    throw error
  })
  return assistantAppPromise
}
