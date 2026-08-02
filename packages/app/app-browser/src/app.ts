import {
  createContext,
  createElement,
  useContext,
  type PropsWithChildren,
  type ReactNode
} from 'react'
import { useStore } from 'zustand'
import type { BrowserShellConfig } from './config'
import { createBrowserShell, type BrowserShell } from './shell'
import { applyBrandMetadata } from './branding'
import { createAuthStore, type AuthState, type AuthStore } from './stores/auth-store'
import { createChatStore, type ChatState, type ChatStore } from './stores/chat-store'
import {
  createSettingsStore,
  type SettingsState,
  type SettingsStore
} from './stores/settings-store'
import { createStatusStore, type StatusState, type StatusStore } from './stores/status-store'
import {
  createInspectorStore,
  type InspectorState,
  type InspectorStore
} from './stores/inspector-store'
import {
  captureTelemetryException,
  configureTelemetry,
  fingerprintMessage,
  setTelemetryConsent
} from './telemetry/telemetry'
import type { ToolTreeSummarizer } from '@tinytinkerer/contracts'
import type { ContentRenderErrorInfo } from '@tinytinkerer/content-react'
import type { AppToolGroup } from './app-tool-group'
import type { AppAssistantPolicy } from './app-assistant-policy'
import {
  resolveDocumentGlobalCapabilities,
  type DocumentGlobalCapabilities
} from './document-globals'
import {
  PRE_SEND_DISCLOSURE_ACKNOWLEDGED_KEY,
  type PreSendDisclosure
} from './pre-send-disclosure-key'
import { loadPluginModules } from './plugins/registry'

export type { AppToolGroup } from './app-tool-group'

/**
 * A host-provided sign-in, used instead of this shell's own GitHub OAuth.
 *
 * Returns whether the flow actually started. A surface that gets `false` must
 * say so rather than appear to have done something: the reason is always
 * deployment configuration (no client id, no route to a product that owns the
 * callback), which no amount of clicking will change.
 *
 * Exists because a shell running `authMode: 'host-token'` cannot start OAuth at
 * all (`canStartGitHubOAuth` is false), and until now that meant its settings
 * panel rendered "Sign in with GitHub to enable AI responses" with no button
 * under it. An embedder that CAN sign a reader in — the documentation
 * assistant hands off to the product's own login — supplies it here so the
 * ordinary sign-in affordances work rather than being replaced by a parallel UI.
 */
export type AppSignIn = () => boolean

/**
 * What a surface's "reset conversation" control does.
 *
 * - `clear-in-place` empties the active conversation and keeps its id and title.
 *   The historical behaviour, and still the default for every product shell.
 * - `restart` aborts the in-flight run, discards the active conversation, and
 *   creates and selects a fresh one — the semantics the documentation assistant
 *   locked in issue #479 and exposes as `resetActiveConversation`.
 *
 * A behaviour rather than a callback because both are already store actions with
 * documented semantics; a host-supplied function would have to close over stores
 * that `createBrowserApp` is in the middle of creating.
 */
export type ConversationResetBehavior = 'clear-in-place' | 'restart'

export type BrowserApp = {
  shell: BrowserShell
  // Which document-global effects this app owns (issue #479). Always resolved,
  // so a consumer never has to repeat the "absent means yes" default.
  documentGlobals: DocumentGlobalCapabilities
  stores: {
    auth: AuthStore
    chat: ChatStore
    settings: SettingsStore
    status: StatusStore
    inspector: InspectorStore
  }
  // The app's own tool group, if any (absent for web/widget/mobile). Held here so
  // the tool picker (useToolTree) can read it from context — the same group the
  // chat store forwards to the runtime.
  appToolGroup?: AppToolGroup
  // The app's grounding/answer policy (issue #478), if any. Held here — like the
  // tool group — so the transcript renderer can read it from context, since the
  // link allowlist has to apply to every streamed snapshot and not only to the
  // finalized answer the runtime produced.
  appAssistantPolicy?: AppAssistantPolicy
  // App-owned cold-start prompts shown before plugin/MCP/generic suggestions.
  starterPrompts?: readonly string[]
  // A host-provided sign-in, if this app has one. Absent means the shell's own
  // GitHub OAuth is the only route (the behaviour every product surface keeps).
  signIn?: AppSignIn
  /**
   * The tool-tree mapper this app's surfaces use when no enabled plugin
   * contributes one (issue #480 review, finding 1).
   *
   * Held on the app rather than passed at each render site because forgetting it
   * is invisible: `ToolTreeSlot` renders nothing at all without a summarizer, so
   * an app with a perfectly good `appToolGroup` silently has no tool picker. That
   * is exactly what happened to the documentation assistant — its tools were
   * registered, selectable in principle, and unreachable in the real widget.
   *
   * A host whose plugin discovery can never surface a tool-tree plugin (the
   * Docusaurus build aliases discovery to a stub returning `[]`) sets
   * `genericToolTreeSummarizer` here once, and every surface of that app — this
   * widget, and #472's Office later — gets the picker without knowing to ask.
   */
  toolTreeSummarizer?: ToolTreeSummarizer
  // What this app's reset-conversation control does. Always resolved, so a
  // surface never has to repeat the default.
  conversationReset: ConversationResetBehavior
  /**
   * A one-time disclosure this app must have acknowledged before it sends its
   * first prompt (issue #481). Absent for every product app, which gates nothing.
   *
   * Plain data here, deliberately. The gate's STORE is built lazily by the first
   * surface that needs it (`pre-send-disclosure.ts`), because `app.ts` is in
   * every shell's startup entry and that entry has kilobytes of headroom, not
   * tens.
   */
  preSendDisclosure?: PreSendDisclosure
  /**
   * The disclosure version this reader last acknowledged in this app's storage
   * namespace, read once during {@link initializeBrowserApp}.
   *
   * Read eagerly even though the store is lazy, and mutable so an acknowledgement
   * outlives any single store: it is what lets the lazily-built gate start out
   * ALREADY hydrated, instead of having to answer "I don't know yet" — which, for
   * a privacy gate, must mean "ask again" and would have re-prompted a reader who
   * accepted months ago.
   */
  preSendDisclosureAcknowledged: string | null
}

const BrowserAppContext = createContext<BrowserApp | undefined>(undefined)

// Guards the discovery-time reconciliation sweep below (issue #400 review,
// F2/F3) to at most once per BrowserApp instance — a WeakSet keyed on the app
// object rather than a plain module-level boolean because a test file can
// construct multiple BrowserApp instances in the same module scope, and each is
// its own "session". React StrictMode double-invokes the bootstrap effect that
// calls `initializeBrowserApp`, so without this guard the sweep would fire twice
// per real session too.
const reconciledPluginTools = new WeakSet<BrowserApp>()

const browserAppError = (): Error =>
  new Error(
    'Browser app has not been created. Call createBrowserApp() and mount <AppBrowserProvider>.'
  )

const requireBrowserApp = (app: BrowserApp | undefined): BrowserApp => {
  if (!app) {
    throw browserAppError()
  }

  return app
}

export const createBrowserApp = (
  config: BrowserShellConfig,
  options: {
    // The app's always-on tool group (e.g. an integrated shell's stage tools).
    // Threaded down to the chat store / runtime AND held on the app for the tool
    // picker; absent for web/widget/mobile.
    appToolGroup?: AppToolGroup
    // The app's grounding/answer policy (issue #478). Threaded down to the chat
    // store / runtime AND held on the app for the transcript renderer.
    appAssistantPolicy?: AppAssistantPolicy
    starterPrompts?: readonly string[]
    // Which document-global effects this app owns (issue #479). Omitted means
    // "owns everything", the correct answer for a document with one app.
    documentGlobals?: Partial<DocumentGlobalCapabilities>
    // A host-provided sign-in (issue #480). Omitted leaves the shell's own
    // GitHub OAuth as the only route, which is what every product app wants.
    signIn?: AppSignIn
    // The fallback tool-tree mapper for this app's surfaces (issue #480 review).
    // Omitted keeps today's behaviour: no picker until an enabled plugin
    // contributes one.
    toolTreeSummarizer?: ToolTreeSummarizer
    // What this app's reset control does (issue #480). Omitted keeps the
    // historical clear-in-place behaviour.
    conversationReset?: ConversationResetBehavior
    /**
     * A one-time disclosure this app must have acknowledged before it sends its
     * first prompt (issue #481). Omitted — every product app — gates nothing.
     */
    preSendDisclosure?: PreSendDisclosure
  } = {}
): BrowserApp => {
  const shell = createBrowserShell(config)
  const documentGlobals = resolveDocumentGlobalCapabilities(options.documentGlobals)
  const auth = createAuthStore(shell)
  // A non-owner must not reach module-global telemetry consent from its own
  // settings action — see the store's own note.
  const settings = createSettingsStore(shell, { ownsTelemetryConsent: documentGlobals.telemetry })
  const status = createStatusStore(shell)
  const inspector = createInspectorStore()
  const chat = createChatStore({
    shell,
    authStore: auth,
    settingsStore: settings,
    inspectorStore: inspector,
    ...(options.appToolGroup ? { appToolGroup: options.appToolGroup } : {}),
    ...(options.appAssistantPolicy ? { appAssistantPolicy: options.appAssistantPolicy } : {}),
    // The outbound-send coordinator (issue #481), supplied only by an app that
    // declares a disclosure. Reached through a dynamic import so the gate's
    // store and dialog stay out of every shell's startup entry, and closing over
    // `app` — which is constructed just below — because the store is created
    // before it. The chat store only ever calls this from an async `sendPrompt`,
    // long after construction has returned.
    ...(options.preSendDisclosure
      ? {
          outboundSendGate: (prompt: string) =>
            import('./pre-send-disclosure').then(({ requestOutboundSendApproval }) =>
              requestOutboundSendApproval(app, prompt)
            )
        }
      : {})
  })

  const app: BrowserApp = {
    shell,
    documentGlobals,
    stores: {
      auth,
      chat,
      settings,
      status,
      inspector
    },
    ...(options.appToolGroup ? { appToolGroup: options.appToolGroup } : {}),
    ...(options.appAssistantPolicy ? { appAssistantPolicy: options.appAssistantPolicy } : {}),
    ...(options.starterPrompts ? { starterPrompts: options.starterPrompts } : {}),
    ...(options.signIn ? { signIn: options.signIn } : {}),
    ...(options.toolTreeSummarizer ? { toolTreeSummarizer: options.toolTreeSummarizer } : {}),
    ...(options.preSendDisclosure ? { preSendDisclosure: options.preSendDisclosure } : {}),
    conversationReset: options.conversationReset ?? 'clear-in-place',
    // Filled in by `initializeBrowserApp` below. `null` until then, which the
    // gate treats as "not acknowledged" — the conservative direction.
    preSendDisclosureAcknowledged: null
  }

  return app
}

export const initializeBrowserApp = async (
  app: BrowserApp,
  config: BrowserShellConfig = {}
): Promise<void> => {
  // From here to `Promise.all` below, every effect is document-global and gated
  // on this app's ownership (issue #479); the store initialization that follows
  // is per-instance and always runs.
  const { documentGlobals } = app
  if (documentGlobals.brandMetadata) {
    applyBrandMetadata(config)
  }
  const { shell } = app
  // Route content render failures (React boundary, runtime per-node catch, and
  // failed lazy plugin loads) to Sentry. The sink no-ops until telemetry is
  // initialized (consent granted, DSN set, non-dev environment), mirroring how
  // the SDK's global handlers only fire after init. Component stack goes in
  // context; the reason + plugin/node fingerprint keeps distinct render failures
  // as distinct issues rather than collapsing under the shared frame.
  const reportContentRender = (error: Error, info: ContentRenderErrorInfo): void => {
    captureTelemetryException(error, {
      level: 'error',
      tags: {
        source: 'content-render',
        ...(info.reason ? { content_render_reason: info.reason } : {}),
        ...(info.nodeType ? { content_node_type: info.nodeType } : {}),
        ...(info.pluginId ? { content_plugin: info.pluginId } : {})
      },
      ...(info.componentStack
        ? { contexts: { react: { componentStack: info.componentStack } } }
        : {}),
      fingerprint: [
        'content-render',
        info.reason ?? 'render',
        info.pluginId ?? info.nodeType ?? 'unknown',
        fingerprintMessage(error.message)
      ]
    })
  }
  // content-react is imported dynamically so its heavy chunk stays out of the
  // startup entry bundle (cross-package subpath imports are forbidden, so we
  // cannot reach the leaf reporter module on its own). The import is kicked off
  // here and awaited at the end of initialization — overlapping store init so it
  // adds little latency — so this function only resolves once the sink is
  // registered. That closes the race where content rendered before a
  // fire-and-forget registration would silently drop its error.
  //
  // The sink is module-global, so a second app in the same document would
  // simply replace the first app's registration; only the owner registers one.
  const reporterReady = !documentGlobals.contentRenderReporter
    ? Promise.resolve()
    : import('@tinytinkerer/content-react')
        .then(({ setContentRenderErrorReporter }) => {
          setContentRenderErrorReporter(reportContentRender)
        })
        .catch((error: unknown) => {
          // Telemetry wiring must never break startup; surface the failure in
          // dev and continue without the content-render sink.
          console.error('Failed to wire content render telemetry', error)
        })
  // Configuration AND the pseudonymous install identity, which
  // `configureTelemetry` reads from this shell's own preferences. Both are
  // module-global, so a non-owner booting second would otherwise republish the
  // document's telemetry identity as its own namespace's.
  if (documentGlobals.telemetry) {
    await configureTelemetry(
      {
        ...(shell.config.sentryDsn ? { dsn: shell.config.sentryDsn } : {}),
        environment: shell.config.sentryEnvironment,
        appVersion: shell.config.appVersion,
        buildHash: shell.config.buildHash
      },
      shell.preferences
    )
  }
  await Promise.all([
    app.stores.auth.getState().initialize(),
    app.stores.settings.getState().initialize(),
    // The pre-send disclosure's acknowledgement (issue #481). Awaited with the
    // rest, deliberately: `BrowserAppShell` withholds its children until this
    // function resolves, so no composer can exist before this has been read, and
    // the lazily-built gate is therefore never the thing deciding what to do
    // about an unknown answer. A read failure leaves it `null`, which prompts —
    // the conservative direction.
    //
    // One preference read rather than the gate's store, because this module is
    // in every shell's startup entry and the store is not (see
    // ./pre-send-disclosure.ts).
    ...(app.preSendDisclosure
      ? [
          shell.preferences
            .get(PRE_SEND_DISCLOSURE_ACKNOWLEDGED_KEY)
            .catch(() => undefined)
            .then((version) => {
              app.preSendDisclosureAcknowledged = version ?? null
            })
        ]
      : [])
  ])
  // Discovery-time reconciliation (issue #400 review, F2/F3) needs BOTH
  // discovered plugin manifests AND hydrated settings — this is the one spot in
  // the browser bootstrap where they're guaranteed to have met: settings just
  // finished hydrating above, and `loadPluginModules()` is the same cached
  // discovery every other host surface (usePluginModules, chat-store) already
  // shares, so this adds no second discovery path. Fire-and-forget: unlike
  // auth/settings hydration, nothing later in this function (or the UI-ready
  // gate that awaits it) depends on the sweep, and it must not add startup
  // latency. Guarded by `reconciledPluginTools` so it runs at most once per
  // session even under StrictMode's double effect invocation.
  if (!reconciledPluginTools.has(app)) {
    reconciledPluginTools.add(app)
    void loadPluginModules()
      .then((modules) => {
        const plugins = modules.map((mod) => ({
          id: mod.manifest.id,
          toolIds: (mod.manifest.toolDescriptors ?? []).map((descriptor) => descriptor.id)
        }))
        return app.stores.settings.getState().reconcilePluginTools(plugins)
      })
      // Best-effort: a failed sweep (e.g. a preferences write error) must not
      // become an unhandled rejection at bootstrap — the stored state stays as
      // it was and is healed by the next write or the next session's sweep.
      .catch(() => {})
  }
  // Restore Sentry for returning users who previously opted in.
  //
  // Owner-only (issue #479). Consent is one module-global flag, but
  // `telemetryEnabled` is persisted per storage namespace, so a non-owner
  // restoring its own stale `true` would switch telemetry back on over the
  // owner's decision — the outcome decided by nothing more than boot order.
  if (documentGlobals.telemetry && app.stores.settings.getState().telemetryEnabled) {
    await setTelemetryConsent(true)
  }
  // Ensure the content-render sink is registered before initialization resolves
  // (and thus before the UI is marked ready) so no early render slips past it.
  await reporterReady
}

export const AppBrowserProvider = ({
  app,
  children
}: PropsWithChildren<{ app: BrowserApp }>): ReactNode =>
  createElement(BrowserAppContext.Provider, { value: app }, children)

export const useBrowserApp = (): BrowserApp => requireBrowserApp(useContext(BrowserAppContext))

export const useAuthStore = <T>(selector: (state: AuthState) => T): T =>
  useStore(useBrowserApp().stores.auth, selector)

export const useChatStore = <T>(selector: (state: ChatState) => T): T =>
  useStore(useBrowserApp().stores.chat, selector)

// NOTE: no `useChatStoreWithEquality` sibling lives here despite the naming
// symmetry with the hooks above — see surfaces.tsx, which defines its own
// (issue #430 review): this file is imported eagerly by every shell's entry
// (`createBrowserApp`/`AppBrowserProvider`), so a real value import of
// `zustand/traditional` here — needed only by the lazily-loaded chat
// surface — would pull `useSyncExternalStoreWithSelector` into every entry
// chunk for a hook nothing eager ever calls.

export const useSettingsStore = <T>(selector: (state: SettingsState) => T): T =>
  useStore(useBrowserApp().stores.settings, selector)

export const useStatusStore = <T>(selector: (state: StatusState) => T): T =>
  useStore(useBrowserApp().stores.status, selector)

export const useInspectorStore = <T>(selector: (state: InspectorState) => T): T =>
  useStore(useBrowserApp().stores.inspector, selector)

export const useOptionalBrowserApp = (): BrowserApp | undefined => useContext(BrowserAppContext)
