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
  genericToolTreeSummarizer,
  resolveBrowserShellBootstrapConfig,
  type AppAssistantPolicy,
  type AppSignIn,
  type AppToolGroup,
  type BrowserApp,
  type BrowserShellConfig,
  type ConversationResetBehavior,
  type DocumentGlobalCapabilities,
  type PreSendDisclosure
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
  /**
   * A one-time disclosure this app must have acknowledged before its first send
   * (issue #481). The assistant supplies one; the live labs do not, because a
   * `<LiveLab>` already carries a standing notice above the surface and every
   * lab page states what it contacts before rendering anything that could.
   */
  preSendDisclosure?: PreSendDisclosure
}

export const createDocsBrowserApp = async ({
  storageNamespace,
  runtimeConfig,
  appToolGroup,
  appAssistantPolicy,
  starterPrompts,
  documentGlobals,
  signIn,
  conversationReset,
  preSendDisclosure
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
      ...(appToolGroup
        ? {
            appToolGroup,
            // Every docs app with its own tools gets the picker, structurally
            // (issue #480 review, finding 1). `docusaurus.config.ts` aliases
            // plugin discovery to a stub that resolves to `[]`, so no plugin can
            // ever contribute a tool-tree mapper here — and without one
            // `ToolTreeSlot` renders nothing, which is indistinguishable from
            // "this app has no tools". Set here rather than at each call site so
            // the assistant, the live labs and #472 cannot each forget it.
            toolTreeSummarizer: genericToolTreeSummarizer
          }
        : {}),
      ...(appAssistantPolicy ? { appAssistantPolicy } : {}),
      ...(starterPrompts ? { starterPrompts } : {}),
      ...(signIn ? { signIn } : {}),
      ...(conversationReset ? { conversationReset } : {}),
      ...(preSendDisclosure ? { preSendDisclosure } : {}),
      // No documentation app can ask its reader a question mid-run (issue #479
      // decision 4, restated as an app capability by #489's review). Plugin
      // discovery is stubbed here and no documentation tool requests human
      // input, so there is nothing to prompt for — and declaring that once, on
      // the app, is what keeps the runtime from advertising a capability whose
      // prompts nothing would draw.
      //
      // Set here rather than at each call site so the assistant, the live labs
      // and #472 cannot each forget it — the same reason `toolTreeSummarizer`
      // is set here. #495 flips this for whichever docs app gains a
      // HITL-capable plugin, and the guard test in
      // `docs-runtime/__tests__/no-human-prompt.test.ts` fails first if it does
      // not.
      humanInput: false,
      documentGlobals
    }),
    config
  }
}
