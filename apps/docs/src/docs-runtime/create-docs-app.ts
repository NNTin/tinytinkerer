/**
 * The one way a `BrowserApp` is built inside the documentation site (issue
 * #479).
 *
 * Extracted from `live-lab/client-runtime.tsx`, which had been the only docs
 * surface that needed one. #479 adds a second — the global documentation
 * assistant — and the two must share their bootstrap (same edge config, same
 * read-only product token, same anonymous shared-quota behaviour, same sign-in
 * route) while sharing nothing else: not conversations, not settings, not tools,
 * and not the document-global effects.
 *
 * Every caller must therefore say which storage namespace it owns and which
 * document-global effects it owns. There is no default for either, deliberately:
 * a wrong answer to the first silently merges two visitors' histories, and a
 * wrong answer to the second silently lets one app overwrite the other's
 * telemetry consent.
 *
 * This module is only ever reached through a dynamic `import()` — see
 * `live-lab/LiveLab.tsx` and `docs-runtime/AssistantRuntimeHost.tsx`, both of
 * which sit behind Docusaurus' `<BrowserOnly>` — so no static page pulls the
 * product runtime, and no static render executes it.
 */
import {
  createBrowserApp,
  createBrowserShell,
  resolveBrowserShellBootstrapConfig,
  type AppAssistantPolicy,
  type AppSignIn,
  type AppToolGroup,
  type BrowserApp,
  type BrowserShellConfig,
  type ConversationResetBehavior,
  type DocumentGlobalCapabilities
} from '@tinytinkerer/app-browser'
import type { DocsRuntimeConfig } from './runtime-config'

export type DocsBrowserApp = { app: BrowserApp; config: BrowserShellConfig }

export type CreateDocsBrowserAppOptions = {
  /**
   * The IndexedDB database this app owns. Distinct per surface and never the
   * product's own default namespace (`tinytinkerer`).
   */
  storageNamespace: string
  runtimeConfig: DocsRuntimeConfig
  /** The app's intrinsic tool group, if it has one. */
  appToolGroup?: AppToolGroup
  /** The app's grounding/answer policy (issue #478), if it has one. */
  appAssistantPolicy?: AppAssistantPolicy
  starterPrompts?: readonly string[]
  /**
   * Which document-global effects this app owns. Required rather than
   * defaulted: with two apps in one document, "whatever the default is" is
   * exactly the reasoning that produces two telemetry identities and a consent
   * decision decided by boot order.
   */
  documentGlobals: DocumentGlobalCapabilities
  /**
   * A host-provided sign-in (issue #480). Docs shells run `authMode:
   * 'host-token'` and so can never start OAuth themselves — without this, their
   * settings panel offers sign-in and renders no button under it.
   */
  signIn?: AppSignIn
  /** What this app's reset-conversation control does (issue #480). */
  conversationReset?: ConversationResetBehavior
}

export const createDocsBrowserApp = async ({
  storageNamespace,
  runtimeConfig,
  appToolGroup,
  appAssistantPolicy,
  starterPrompts,
  documentGlobals,
  signIn,
  conversationReset
}: CreateDocsBrowserAppOptions): Promise<DocsBrowserApp> => {
  // Read-only peek at the PRODUCT's own default-namespace token store (same
  // origin, same IndexedDB the main app already writes to). Never written back —
  // this is exactly what a "same-origin auth token, isolated everything-else"
  // reuse looks like: the token travels into this shell's config as a
  // `hostToken` (kept in memory only, see @tinytinkerer/app-browser's
  // AuthTokenStore contract), while conversations/preferences/model selection go
  // into a completely separate IndexedDB database below.
  //
  // A signed-out visitor gets `null` here and uses the shared, rate-limited key,
  // which is the anonymous quota path every TinyTinkerer chat surface offers.
  const productShell = createBrowserShell({})
  const hostToken = await productShell.authTokens.getStoredToken()

  const config = resolveBrowserShellBootstrapConfig({
    baseUrl: '/',
    origin: window.location.origin,
    edgeBaseUrl: runtimeConfig.edgeBaseUrl,
    storageNamespace,
    // 'host-token': a docs shell never runs its own GitHub OAuth
    // (canStartGitHubOAuth is false), it only ever borrows the token above.
    // Sign-in happens through beginDocsProductSignIn's separate,
    // product-namespace shell instead.
    authMode: 'host-token',
    hostToken,
    sentryDsn: runtimeConfig.sentryDsn,
    sentryEnvironment: runtimeConfig.sentryEnvironment,
    appVersion: 'docs',
    buildHash: 'docs'
  })

  return {
    app: createBrowserApp(config, {
      ...(appToolGroup ? { appToolGroup } : {}),
      ...(appAssistantPolicy ? { appAssistantPolicy } : {}),
      ...(starterPrompts ? { starterPrompts } : {}),
      ...(signIn ? { signIn } : {}),
      ...(conversationReset ? { conversationReset } : {}),
      documentGlobals
    }),
    config
  }
}
