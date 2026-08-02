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
import { DOCS_ASSISTANT_DISCLOSURE } from './assistant-disclosure'
import { createDocsBrowserApp, type DocsBrowserApp } from './create-docs-app'
import { beginDocsProductSignIn } from './product-sign-in'
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
    // Route-NEUTRAL, because they are fixed at construction while the assistant
    // is present on search results and 404s too. #480's widget overrides them
    // per route through `ChatApp`'s `starterPrompts`, prepending current-page
    // suggestions only where #476 reports an authored document.
    starterPrompts: DOCS_ASSISTANT_STARTER_PROMPTS,
    // The docs shells borrow a product token and can never start OAuth
    // themselves, so without this the ordinary sign-in affordances would offer a
    // flow that cannot begin (issue #480). Hands off to the product's own GitHub
    // login, which owns the callback; anonymous shared-quota use continues
    // meanwhile and is never blocked on it.
    signIn: () => beginDocsProductSignIn(runtimeConfig),
    // #479's locked reset semantics — abort the run, discard the active
    // conversation, create and select a fresh one — reached from the widget's own
    // reset control rather than only from the session facade. The store's
    // clear-in-place default keeps an emptied conversation's id and title, which
    // is not what this assistant documented that button as doing.
    conversationReset: 'restart',
    // #481's pre-send disclosure. Enforced in `submitPrompt` and drawn by one
    // host above every assistant surface, so nothing about the conversation —
    // and nothing a documentation tool would read — leaves the browser until a
    // reader has been told where it goes. Acknowledged per THIS namespace, and
    // separately versioned from telemetry consent and the global privacy policy.
    preSendDisclosure: DOCS_ASSISTANT_DISCLOSURE,
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
