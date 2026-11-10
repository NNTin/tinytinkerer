---
title: Embedding TinyTinkerer in another app
sidebar_label: Embed package
sidebar_position: 4
description: Install @nntin/tinytinkerer-embed from GitHub Packages and mount the assistant, with your own tools, on your own page.
---

<!--
This page documents the published @nntin/tinytinkerer-embed package
(packages/app/embed). Update it when that package's public entry changes.
-->

# Embedding TinyTinkerer in another app

`@nntin/tinytinkerer-embed` is TinyTinkerer's browser chat runtime as one prebuilt ESM package,
with TypeScript declarations. A host such as CanFactory uses it to put the assistant on its own
page, with the host's own tools, in the same way the documentation site embeds it. It contains:

- the browser runtime from `@tinytinkerer/app-browser` and its workspace dependencies;
- the `createStageTools` adapter from `@tinytinkerer/app-shell`;
- the plugin catalogue;
- two stylesheets.

The host adds no assistant backend and holds no model credentials. Model calls, per-user LiteLLM
keys and the MCP proxy all go through a TinyTinkerer edge (see [Self-hosting](../self-hosting/index.md)).

## Install

The package is published to GitHub Packages. GitHub Packages needs a token **even to read a
public package**, so the consuming project needs an `.npmrc`:

```ini title=".npmrc"
@nntin:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Then install the package. `react` and `react-dom` 19 are its only peer dependencies:

```bash
NODE_AUTH_TOKEN=<token with read:packages> npm install @nntin/tinytinkerer-embed@next
```

- **Locally:** `NODE_AUTH_TOKEN` is a personal access token (classic) with `read:packages`.
- **In GitHub Actions:** use the workflow's `GITHUB_TOKEN` with `permissions: packages: read`. This
  works only after the package grants the consuming repository read access. That is a one-time
  owner step per repository, done in the package's settings under **Manage Actions access**.
  `NNTin/CanFactory` needs this grant.

Nothing else is installed into your dependency tree. Every workspace package and every
third-party library the runtime uses is compiled into the package. That includes Zod, Dexie,
Zustand, React Query and Sentry.

### Versions

The package follows semver. Releases are published from this repository's release workflow on
every release, as `0.x` prereleases under the `next` dist-tag, for example `0.1.0-next.12`. Pin
an exact version.

A breaking change to `createBrowserApp`, `ChatApp`'s props, `AppToolGroup` or `Tool` bumps the
major version. Anything not exported from the entry below is internal and can change in any
release.

## What the package exports

All exports come from the package root, `@nntin/tinytinkerer-embed`.

| Export                                  | What it is                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `resolveBrowserShellBootstrapConfig`    | Builds the shell config (edge URL, storage namespace, auth mode, theme)                                |
| `createBrowserApp`                      | Builds one assistant app: stores, plugins, your tool group                                             |
| `BrowserAppShell`                       | Boots the app and provides it to everything inside it                                                  |
| `ChatApp`                               | The chat surface, in a floating or docked layout                                                       |
| `completeGitHubOAuth`                   | Completes GitHub's redirect back to your page and signs the app in ([host sign-in](./host-sign-in.md)) |
| `GITHUB_OAUTH_CALLBACK_PATH`            | The callback path to use as `githubRedirectUri`: `/auth/github/callback`                               |
| `isSignInRequired`                      | Whether an app's shell requires sign-in before it answers (`authMode: 'oauth'`)                        |
| `createStageTools`                      | Turns a request handle plus a method table into `Tool`s, as the integrated stages do                   |
| `z`                                     | The Zod instance the runtime reads tool schemas with                                                   |
| `loadPlugins`, `CATALOGUE_PLUGIN_NAMES` | The plugin catalogue: load a named subset, or list every name                                          |
| `genericToolTreeSummarizer`             | The fallback tool-picker mapper for an app with its own tools                                          |
| `DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES`  | The `documentGlobals` value for a page that owns everything                                            |
| `NO_GLOBAL_HOST_CAPABILITIES`           | The `globalHosts` value for a shell that mounts no document-level dialogs                              |

Types: `AppTool`, `AppToolGroup`, `AppToolRunBindings`, `AppToolRunImplementation`, `Tool`,
`ActivitySummarizer`, `ActivityStatus`, `ActivityView`, `ActivityViewSection`, `AppAssistantPolicy`,
`AppInstructionBoundary`, `AppToolResultRecord`, `AppSignIn`, `BrowserApp`, `BrowserAppShellProps`,
`BrowserAuthMode`, `BrowserShell`, `BrowserShellBootstrapOptions`, `BrowserShellConfig`, `CataloguePluginName`,
`ChatAppProps`, `ChatDockEdge`, `ChatLoadingComponent`, `ChatMode`, `ChatPresentation`,
`ConversationResetBehavior`, `CreateStageToolsOptions`, `DocumentGlobalCapabilities`,
`GlobalHostCapabilities`, `HostMcpServer`, `PluginCatalogue`, `PreSendDisclosure`, `ShellThemeTokens`,
`StageToolDefinition`, `StageToolRequestHandle`, `ToolTreeSummarizer`, `ToolTreeView`.

Two subpath exports carry the stylesheets: `@nntin/tinytinkerer-embed/embed.css` and
`@nntin/tinytinkerer-embed/styles.css`.

## Configuration

`resolveBrowserShellBootstrapConfig(options)` returns the `BrowserShellConfig` that both
`createBrowserApp` and `BrowserAppShell` take.

| Option              | Meaning                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`, `origin` | Required. Your app's base path and `window.location.origin`                                                                                                                                                                  |
| `edgeBaseUrl`       | The TinyTinkerer edge, e.g. `https://api.tiny.nntin.xyz`. The edge must list your origin in `ALLOWED_ORIGINS`                                                                                                                |
| `storageNamespace`  | The IndexedDB database this app owns: conversations, settings, model choice. Use your own, e.g. `'canfactory'`. Never `'tinytinkerer'`, the product's own namespace, or two apps on one origin will share histories          |
| `authMode`          | `'oauth'` (the app runs GitHub sign-in itself), `'host-token'` (the host supplies a token in `hostToken` and the app never starts OAuth), or `'hybrid'` (the default: OAuth, or the shared anonymous quota while signed out) |
| `githubClientId`    | The GitHub OAuth App's client id, for `'oauth'` and `'hybrid'`                                                                                                                                                               |
| `githubRedirectUri` | Where GitHub sends the user back: `${window.location.origin}${GITHUB_OAUTH_CALLBACK_PATH}` on an embedding host. Defaults to the hash route `<baseUrl>#/auth/callback` on your origin when only a client id is given         |
| `theme`             | Optional colours mapped onto the shell's tokens, so the surface blends into your page: `{ background, panel, text, border, accent }`. Every field is optional; an omitted one keeps the shell's own value                    |
| `hostToken`         | A GitHub token the host already holds, for `'host-token'`. Kept in memory only                                                                                                                                               |
| `sentryDsn`, …      | Optional TinyTinkerer telemetry settings. Leave them unset unless you run the shell's telemetry                                                                                                                              |

## `createBrowserApp(config, options)`

`plugins` is the only required option. Every other option has a default that suits a page with
one assistant on it.

| Option               | Meaning                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins`            | Required. A function returning this app's plugins, usually `() => loadPlugins([...names])`. There is no default: name the subset you offer. `() => Promise.resolve([])` offers none                                                                                                                                                                                                           |
| `appToolGroup`       | Your own always-on tools, as one `AppToolGroup` (`{ id, label, tools }`). They are registered in the runtime and shown in the tool picker as one group. They run in the runtime's tool-calling loop, which means the model reads each result before it picks the next call                                                                                                                    |
| `mcpServers`         | MCP servers the host provides, as `HostMcpServer[]` (`{ id, name, url }`, no token). They are discovered at boot and their tools register as `mcp:<id>:<tool>`. They are not stored in the user's settings and are read-only there. The edge injects each server's token, so the browser never holds it. See [MCP integration](../plugins-and-tools/mcp-integration.md#host-provided-servers) |
| `appAssistantPolicy` | Your grounding and answer policy: instruction boundaries, and which links the transcript may render                                                                                                                                                                                                                                                                                           |
| `starterPrompts`     | Suggestions shown on an empty conversation, before plugin or generic ones                                                                                                                                                                                                                                                                                                                     |
| `documentGlobals`    | Which document-wide effects this app owns: `brandMetadata` (TinyTinkerer's favicon/manifest/theme-colour in `<head>`), `telemetry`, `contentRenderReporter`, `oauthCallbackWatchdog`. Omitted fields default to `true`. A host that owns its `<head>` and runs no TinyTinkerer telemetry sets the first two to `false`                                                                        |
| `signIn`             | A host-provided sign-in action. Return `true` if the host started a sign-in. Omitted, the shell's own GitHub OAuth is the only route                                                                                                                                                                                                                                                          |
| `toolTreeSummarizer` | The fallback tool-picker mapper. Pass `genericToolTreeSummarizer` with an `appToolGroup`, so the picker shows your tools even with the tool-tree plugin switched off                                                                                                                                                                                                                          |
| `conversationReset`  | What the reset control does: `'clear-in-place'` (the default) or `'restart'`, which aborts the run and starts a fresh conversation                                                                                                                                                                                                                                                            |
| `preSendDisclosure`  | A one-time notice that must be acknowledged before the first message is sent                                                                                                                                                                                                                                                                                                                  |
| `humanInput`         | Whether this app can ask its user a question in the middle of a run (default `true`). Set it to `false` if none of your tools or plugins asks, and the prompt renderer is never loaded                                                                                                                                                                                                        |

### Tools

A tool is `{ id, description, schema, execute }`, where `schema` is a Zod schema for the tool's
input. Write schemas with the package's exported `z`. Zod is compiled into the package, and the
runtime converts schemas to JSON Schema with that same copy. A schema from another Zod
installation would depend on two copies agreeing about each other's internals.

`createStageTools({ handle, methods })` builds the tool list from a request handle and a table of
methods, the way the Canvas, IDE and Mermaid stages do. Each method becomes a tool whose `execute`
calls `handle.request(method, input)`. See [Integrated application shells](./app-shell.md) for the
pattern.

### MCP servers

`mcpServers` gives every user of your app an MCP server of yours, for example KiPrint for
CanFactory. Each entry is a `HostMcpServer`:

```ts
import type { HostMcpServer } from '@nntin/tinytinkerer-embed'

const mcpServers: HostMcpServer[] = [
  { id: 'kiprint', name: 'KiPrint', url: 'https://kiprint.nntin.xyz/mcp' }
]

const app = createBrowserApp(config, { plugins, mcpServers })
```

- **No token in the browser.** `HostMcpServer` has no token field. Ask the edge's operator to:
  - add the server's hostname to the edge's `MCP_HOST_SERVERS` var;
  - put the token in the `MCP_HOST_TOKENS` secret, a JSON object mapping hostname to token.

  For those hosts the edge drops any token the browser sends and injects its own. The hosts stay
  reachable even when the edge restricts MCP hosts with `MCP_ALLOWED_HOSTS`. The TinyTinkerer
  edges list `kiprint.nntin.xyz` (production) and `kiprint-preview.nntin.xyz` (develop). See
  [Host-provided MCP servers](../self-hosting/vercel-deployment.md#host-provided-mcp-servers) for
  the edge side.

- **Ids:** an `id` must be unique and contain no `:`. `createBrowserApp` throws otherwise. Tools
  register as `mcp:<id>:<toolName>`. They run in the same tool-calling loop as your
  `appToolGroup`, so one turn can chain many calls.
- **Discovery:** discovery runs during `initializeBrowserApp`, and again whenever the user signs in,
  signs out or switches accounts. While signed out it sends nothing, because the edge's MCP routes
  need a signed-in caller.
- **Not the user's to manage.** The servers and their tool lists live in memory only, and are
  never written to the user's settings. Settings lists them above the user's own servers, marked
  "Provided by this app", with their sync status and nothing to toggle, edit or remove. Users can
  still add their own servers beside them.

#### Links your MCP server returns

Tool results pass through the edge unmodified. KiPrint's `export_project`, for instance, returns a
signed, expiring `https://kiprint.nntin.xyz/downloads/<token>` URL. The browser fetches it straight
from KiPrint.

- **No link rule in `appAssistantPolicy`:** every `http(s)` link in an answer stays clickable. The
  download URL works with no extra setup.
- **A link allowlist:** if your policy demotes links it cannot verify (in `prepareRenderedContent`
  and `finalizeAnswer`), allow the links your server actually returned. Each result from a host
  server reaches the policy as an `AppToolResultRecord` with `source: { kind: 'mcp', groupId: '<id>' }`,
  and its `output` is the edge's response: the server's `text` exactly as sent, and `isError`:

```ts
import type { AppToolResultRecord } from '@nntin/tinytinkerer-embed'

// The KiPrint URLs this turn's results actually returned, tool errors excluded.
const kiprintLinks = (results: readonly AppToolResultRecord[]): Set<string> =>
  new Set(
    results
      // A tool error (`isError: true`) still arrives as a completed result, and its
      // text can echo a model-chosen input, so it must never authorize a link.
      .filter(
        (result) =>
          result.source?.kind === 'mcp' &&
          result.source.groupId === 'kiprint' &&
          (result.output as { isError?: unknown }).isError !== true
      )
      .flatMap((result) => {
        const text = (result.output as { text?: unknown }).text
        return typeof text === 'string' ? (text.match(/https:\/\/[^\s"'<>)]+/g) ?? []) : []
      })
      .filter((url) => new URL(url).hostname === 'kiprint.nntin.xyz')
  )
```

Keep a link when its URL is in this set, and demote it otherwise. Match the exact URLs, not just
the host: an answer could otherwise carry a KiPrint path the server never issued.

The `isError` check is required, and only the filter provides it. The runtime passes the policy
every call that did not throw. A call that failed in transport, or that the edge rejected, never
reaches it. But when the MCP server itself reports a tool failure, the edge answers `200` with
`isError: true`, and that result does reach the policy. An error message that echoes its input,
such as `invalid project https://kiprint.nntin.xyz/downloads/<forged>`, would otherwise authorize
a link the model or an injected instruction chose. See
[MCP integration](../plugins-and-tools/mcp-integration.md#results-and-links) for more on results and links.

## Sign-in

With `authMode: 'oauth'`, sign-in is required: a signed-out `ChatApp` shows a "Sign in with GitHub"
call to action instead of the composer, and sends nothing to the edge. On load, before mounting the
chat, the host checks for `GITHUB_OAUTH_CALLBACK_PATH` and calls `completeGitHubOAuth(app)`, then
restores the URL it returns. The whole flow, and the edge's checks on it, are described in
[GitHub sign-in for embedding hosts](./host-sign-in.md).

## Stylesheets

Load both stylesheets, and put the class `tt-app-embed` on the element that wraps the assistant:

- **`embed.css`** is the scoped baseline. It holds a scoped copy of Tailwind's preflight, the
  launcher, the answer prose styles and the token graph. Every rule is keyed on
  `:where(.tt-app-embed)`, so it changes nothing on your page outside the assistant.
- **`styles.css`** holds the component styles and design tokens, plus the Tailwind theme and
  utilities the components use, already compiled. Your app needs no Tailwind for them. If it does
  use Tailwind, it doesn't need to scan this package. The sheet has no global reset.

`ChatApp`'s own stage element carries `tt-app-embed` too, so the docked and floating layouts are
covered even when they render outside your wrapper.

## Loading it lazily

The package is large; the chat surface, the runtime and their dependencies are most of a
deployable app. Load it behind a dynamic `import()`, for example with `React.lazy`. Your page then
pays nothing for it until the assistant is needed. Inside the package, plugins, renderers and
dialogs stay behind their own `import()`s, as separate chunks fetched only when used.

## A minimal host

```tsx title="src/main.tsx"
import { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'

// Nothing from the package loads until this resolves.
const Assistant = lazy(() => import('./assistant'))

createRoot(document.getElementById('root')!).render(
  <Suspense fallback={null}>
    <Assistant />
  </Suspense>
)
```

```tsx title="src/assistant.tsx"
import {
  BrowserAppShell,
  ChatApp,
  completeGitHubOAuth,
  createBrowserApp,
  genericToolTreeSummarizer,
  GITHUB_OAUTH_CALLBACK_PATH,
  loadPlugins,
  resolveBrowserShellBootstrapConfig,
  z,
  type AppToolGroup
} from '@nntin/tinytinkerer-embed'
import '@nntin/tinytinkerer-embed/embed.css'
import '@nntin/tinytinkerer-embed/styles.css'

const measureBoard = z.object({ board: z.string().describe('The board to measure') })

const tools: AppToolGroup = {
  id: 'canfactory',
  label: 'CanFactory',
  tools: [
    {
      id: 'measure_board',
      description: 'Return the width and height, in millimetres, of a named prototype board.',
      schema: measureBoard,
      execute: async (input) => {
        const { board } = measureBoard.parse(input)
        return { board, widthMm: 70, heightMm: 90 }
      }
    }
  ]
}

const config = resolveBrowserShellBootstrapConfig({
  baseUrl: '/',
  origin: window.location.origin,
  edgeBaseUrl: 'https://api.tiny.nntin.xyz',
  storageNamespace: 'canfactory',
  authMode: 'oauth',
  githubClientId: '<the OAuth App client id>',
  githubRedirectUri: `${window.location.origin}${GITHUB_OAUTH_CALLBACK_PATH}`,
  theme: { accent: '#0f766e' }
})

const app = createBrowserApp(config, {
  plugins: () => loadPlugins(['plugin-tool-tree', 'plugin-context-usage']),
  appToolGroup: tools,
  toolTreeSummarizer: genericToolTreeSummarizer,
  starterPrompts: ['How big is a perfboard-70x90?'],
  documentGlobals: { brandMetadata: false, telemetry: false },
  humanInput: false
})

// GitHub redirects back here after sign-in. Finish it before the chat mounts.
if (window.location.pathname === GITHUB_OAUTH_CALLBACK_PATH) {
  const returnUrl = await completeGitHubOAuth(app)
  window.history.replaceState(null, '', returnUrl ?? '/')
}

const Loading = ({ error }: { error?: string }) => (
  <p role="status">{error ? `The assistant could not start: ${error}` : 'Starting…'}</p>
)

export default function Assistant() {
  return (
    <div className="tt-app-embed">
      <BrowserAppShell
        app={app}
        config={config}
        BootScreen={Loading}
        globalHosts={{ telemetryConsent: false, privacyUpdate: false, konami: false }}
      >
        <ChatApp mode="floating" storageKey="canfactory-assistant" LoadingComponent={Loading} />
      </BrowserAppShell>
    </div>
  )
}
```

Create the app **once**, at module scope or in a module-level cache, not in a component body. Each
`createBrowserApp` call is a separate app with its own stores.

## How this is tested

`packages/app/embed/acceptance/` holds a fresh npm project that has nothing but the `.npmrc` above,
pinned React and its own build tools. Its run script packs the package, installs it from scratch
and fails if anything other than the package and React lands in the production dependency tree. It
then typechecks the host with `skipLibCheck: false` and builds it.

The Playwright spec `packages/e2e/tests/embed-package.e2e.ts` serves that build and completes one
chat turn in which the model calls the host's Zod tool, through the real edge worker. The release
workflow runs the same install against each version right after publishing it.
