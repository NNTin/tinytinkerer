/**
 * `@nntin/tinytinkerer-embed` — the public surface an embedding host builds a
 * TinyTinkerer assistant from (issue #510, T1).
 *
 * Curated rather than `export *` from `@tinytinkerer/app-browser`. Everything
 * named here is semver-governed: a breaking change to `createBrowserApp`,
 * `ChatApp`'s props, `AppToolGroup` or `Tool` bumps the major. app-browser's own
 * index carries far more than a host needs (surface controllers, layout
 * geometry, settings panels), and re-exporting all of it would make every
 * internal refactor a breaking release. A host that needs something missing
 * here asks for it, and adding it is a reviewed, minor-version change.
 *
 * Bundling: every workspace package below, and every third-party runtime
 * dependency they carry, is compiled INTO this package's `dist/` — `react` and
 * `react-dom` are the only imports left for the host to resolve, and they are
 * peers. Heavy code stays behind the dynamic `import()`s it already sits behind
 * in the workspace (plugins, renderers, dialogs), so each is its own chunk and
 * is fetched only when used. `scripts/check-package.mjs` asserts both.
 */

// ── Building the app ────────────────────────────────────────────────────────
export {
  createBrowserApp,
  resolveBrowserShellBootstrapConfig,
  DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES,
  NO_GLOBAL_HOST_CAPABILITIES,
  genericToolTreeSummarizer
} from '@tinytinkerer/app-browser'
export type {
  AppAssistantPolicy,
  AppInstructionBoundary,
  AppSignIn,
  AppToolResultRecord,
  BrowserApp,
  BrowserAuthMode,
  BrowserShell,
  BrowserShellBootstrapOptions,
  BrowserShellConfig,
  ConversationResetBehavior,
  DocumentGlobalCapabilities,
  GlobalHostCapabilities,
  HostMcpServer,
  PluginCatalogue,
  PreSendDisclosure,
  ShellThemeTokens,
  ToolTreeSummarizer,
  ToolTreeView
} from '@tinytinkerer/app-browser'

// ── Signing in on the host's origin (#510 T5) ───────────────────────────────
// `authMode: 'oauth'` makes sign-in required; the host completes GitHub's
// redirect to GITHUB_OAUTH_CALLBACK_PATH with completeGitHubOAuth. A host that
// does so from EAGER code imports `@nntin/tinytinkerer-embed/oauth` instead
// (src/oauth.ts): this entry is not tree-shakeable. See
// docs/extending/host-sign-in.md.
export {
  completeGitHubOAuth,
  GITHUB_OAUTH_CALLBACK_PATH,
  isGitHubOAuthCallback,
  isSignInRequired
} from '@tinytinkerer/app-browser'

// ── Rendering it ────────────────────────────────────────────────────────────
export { BrowserAppShell, ChatApp } from '@tinytinkerer/app-browser'
export type {
  BrowserAppShellProps,
  ChatAppProps,
  ChatLoadingComponent,
  ChatMode
} from '@tinytinkerer/app-browser'
export type { ChatDockEdge, ChatPresentation } from '@tinytinkerer/app-browser/chat-presentation'

// ── Host-provided MCP servers (#518 F5) ─────────────────────────────────────
// `createBrowserApp(config, { mcpServers })` provides them; these let a host
// render their status (`app.stores.hostMcp`) and retry a failed discovery.
// See docs/extending/host-mcp-servers.md.
export { hostMcpServerStatus, retryHostMcpDiscovery, useHostMcp } from '@tinytinkerer/app-browser'
export type { HostMcpServerStatus, HostMcpState, HostMcpStore } from '@tinytinkerer/app-browser'

// ── The host's own tools ────────────────────────────────────────────────────
export type {
  ActivityStatus,
  ActivitySummarizer,
  ActivityView,
  ActivityViewSection,
  AppTool,
  AppToolGroup,
  AppToolRunBindings,
  AppToolRunImplementation,
  Tool
} from '@tinytinkerer/app-browser'
export { createStageTools } from '@tinytinkerer/app-shell'
export type {
  CreateStageToolsOptions,
  StageToolDefinition,
  StageToolRequestHandle
} from '@tinytinkerer/app-shell'

/**
 * The Zod instance the runtime reads tool schemas with.
 *
 * Exported because Zod is bundled, not a peer: a host that authors a tool's
 * `schema` with this `z` hands the runtime a schema from the same copy it
 * converts to JSON Schema and validates with, so nothing depends on two Zod
 * copies agreeing about each other's internals or registries.
 */
export { z } from 'zod'

// ── Plugins an embedder can choose from ─────────────────────────────────────
export { CATALOGUE_PLUGIN_NAMES, loadPlugins } from '@tinytinkerer/catalogue'
export type { CataloguePluginName } from '@tinytinkerer/catalogue'
