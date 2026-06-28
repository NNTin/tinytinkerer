// @tinytinkerer/app-harness — the shared harness that hosts a sandboxed iframe app
// and wires it into the chat shell. A per-app shell composes <HarnessShell> (or
// <AppFrame> directly), declares its app's verbs, and passes the resulting
// appTools to createBrowserShellRoot — keeping each shell thin and app-agnostic.
export { createAppBridgeHandle } from './bridge-handle'
export type { AppBridgeHandle, AppBridgeStatus } from './bridge-handle'

export { appToolsFromVerbs } from './app-tools'
export type { VerbDefinition, AppToolsFromVerbsOptions } from './app-tools'

export { AppFrame, APP_BRIDGE_NONCE_PARAM } from './app-frame'
export type { AppFrameProps, AppFrameStatus } from './app-frame'

export { HarnessShell } from './harness-shell'
export type { HarnessShellProps } from './harness-shell'

export { resolveEmbeddedAppUrl } from './app-url'
