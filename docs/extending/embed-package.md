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

All exports below come from the package root, `@nntin/tinytinkerer-embed`. Two side-effect-free
subpaths, [`/oauth`](#the-oauth-subpath) and [`/stage`](#the-stage-subpath), carry the few values
a host needs before the assistant loads.

**Import the package root only from code you load lazily** ([Loading it lazily](#loading-it-lazily)).
Code on your startup path, such as finishing GitHub's sign-in redirect or installing a stage
controller when your editor mounts, imports a subpath instead. See
[Eager code and lazy code](#eager-code-and-lazy-code) for what each entry costs.

| Export                                  | What it is                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `resolveBrowserShellBootstrapConfig`    | Builds the shell config (edge URL, storage namespace, auth mode, theme)                                |
| `createBrowserApp`                      | Builds one assistant app: stores, plugins, your tool group                                             |
| `BrowserAppShell`                       | Boots the app and provides it to everything inside it                                                  |
| `ChatApp`                               | The chat surface, in a floating or docked layout                                                       |
| `completeGitHubOAuth`                   | Completes GitHub's redirect back to your page and signs the app in ([host sign-in](./host-sign-in.md)) |
| `GITHUB_OAUTH_CALLBACK_PATH`            | The callback path to use as `githubRedirectUri`: `/auth/github/callback`                               |
| `isGitHubOAuthCallback`                 | Whether a URL (default: the current location) is that callback                                         |
| `isSignInRequired`                      | Whether an app's shell requires sign-in before it answers (`authMode: 'oauth'`)                        |
| `createStageTools`                      | Turns a request handle plus a method table into `Tool`s, as the integrated stages do                   |
| `createStageControllerHandle`           | A stable handle your tools call, for a controller that mounts later                                    |
| `z`                                     | The Zod instance the runtime reads tool schemas with                                                   |
| `loadPlugins`, `CATALOGUE_PLUGIN_NAMES` | The plugin catalogue: load a named subset, or list every name                                          |
| `genericToolTreeSummarizer`             | The fallback tool-picker mapper for an app with its own tools                                          |
| `DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES`  | The `documentGlobals` value for a page that owns everything                                            |
| `EMBEDDED_DOCUMENT_GLOBAL_CAPABILITIES` | The `documentGlobals` value for an embedding host: all four `false`                                    |
| `NO_GLOBAL_HOST_CAPABILITIES`           | The `globalHosts` value for a shell that mounts no document-level dialogs                              |
| `useHostMcp`                            | React hook over `app.stores.hostMcp`: your MCP servers and their discovery status                      |
| `hostMcpServerStatus`                   | One host server's status: `syncing`, `signed-out`, `available` or `unavailable` (with its error)       |
| `retryHostMcpDiscovery`                 | Re-runs discovery of your MCP servers with the current token                                           |

Types: `AppTool`, `AppToolGroup`, `AppToolRunBindings`, `AppToolRunImplementation`, `Tool`,
`ActivitySummarizer`, `ActivityStatus`, `ActivityView`, `ActivityViewSection`, `AppAssistantPolicy`,
`AppInstructionBoundary`, `AppToolResultRecord`, `AppSignIn`, `BrowserApp`, `BrowserAppShellProps`,
`BrowserAuthMode`, `BrowserShell`, `BrowserShellBootstrapOptions`, `BrowserShellConfig`, `CataloguePluginName`,
`ChatAppProps`, `ChatDockEdge`, `ChatLoadingComponent`, `ChatMode`, `ChatPresentation`,
`ConversationResetBehavior`, `CreateControllerStageToolsOptions`, `CreateStageToolsOptions`, `DocumentGlobalCapabilities`,
`GlobalHostCapabilities`, `HostMcpServer`, `HostMcpServerStatus`, `HostMcpState`, `HostMcpStore`, `PluginCatalogue`, `PreSendDisclosure`, `ShellThemeTokens`,
`StageControllerHandle`, `StageControllerMethod`, `StageToolDefinition`, `StageToolRequestHandle`, `ToolTreeSummarizer`, `ToolTreeView`.

Two subpath exports carry the stylesheets: `@nntin/tinytinkerer-embed/embed.css` and
`@nntin/tinytinkerer-embed/styles.css`.

### Eager code and lazy code

| Where the import is                                      | Import from                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| Your startup path: the entry, your router, eager editors | `@nntin/tinytinkerer-embed/oauth`, `@nntin/tinytinkerer-embed/stage` |
| The module you load with `import()` or `React.lazy`      | `@nntin/tinytinkerer-embed`                                          |

The root bundles the runtime as a few large chunks. The chunk that defines `ChatApp` and the
shell runs React `lazy()` calls, store setup and renderer registration when it loads. A host's
bundler has to keep that code, so any export defined in that chunk brings the runtime with it.
Root exports that live in a chunk of their own are cheap, because the package marks its
JavaScript side-effect free and your bundler can drop every chunk you don't use. Since issue #523 the
light helpers (`createStageControllerHandle`, `createStageTools`, `CATALOGUE_PLUGIN_NAMES`,
`genericToolTreeSummarizer`, the callback constants) and Zod each have their own chunk.

What one import adds to a host build, measured with a minifying Vite 8 build, gzipped, with
React excluded:

| Import                                                                                                | Adds (gzip) |
| ----------------------------------------------------------------------------------------------------- | ----------- |
| `@nntin/tinytinkerer-embed/stage` (both helpers)                                                      | 0.4 kB      |
| `@nntin/tinytinkerer-embed/oauth` (all three exports)                                                 | 0.9 kB      |
| `createStageControllerHandle` or `createStageTools` from the root                                     | 0.2 kB      |
| `CATALOGUE_PLUGIN_NAMES` or `genericToolTreeSummarizer` from the root                                 | 0.3–1.2 kB  |
| `DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES` (or the other two) from the root                               | 4.1 kB      |
| `createBrowserApp` from the root                                                                      | 13.2 kB     |
| `loadPlugins` from the root                                                                           | 39.2 kB     |
| `z` from the root (the whole Zod namespace)                                                           | 90.2 kB     |
| `ChatApp` from the root                                                                               | 103.6 kB    |
| `BrowserAppShell`, `ChatApp`, `createBrowserApp`, `loadPlugins`, `resolveBrowserShellBootstrapConfig` | 132.8 kB    |
| The same plus `z`                                                                                     | 187.7 kB    |
| Every root export                                                                                     | 189.0 kB    |

Before these chunks were split out, any single value from the root cost at least 88 kB, `z` alone
cost 149 kB and every export cost 195 kB. The runtime itself (about 133 kB for a working chat)
is what the assistant needs to run. Plugins, renderers, dialogs and CodeMirror stay in further
chunks behind their own `import()`s and are not counted above.

Don't treat a cheap root import as a licence to import the root eagerly. Which exports share a
chunk is a build detail, and it can change between releases; the subpaths are the contract. Your
bundler also has to honour `sideEffects`, as Vite, Rollup, Rolldown, webpack and esbuild do.

### The `/oauth` subpath

`@nntin/tinytinkerer-embed/oauth` is side-effect free and imports nothing: no React, no stores, no
telemetry. It is safe to import from your eager entry. It exports `GITHUB_OAUTH_CALLBACK_PATH`,
`isGitHubOAuthCallback(url?)` and a light `completeGitHubOAuth(config, url?)` that needs no
`BrowserApp`: it saves the token, and the next app boot picks it up. See
[Completing the callback](./host-sign-in.md#completing-the-callback).

### The `/stage` subpath

`@nntin/tinytinkerer-embed/stage` is side-effect free and imports nothing: no React, no Zod, no
stores. It exports `createStageControllerHandle` and `createStageTools`, with the types
`StageControllerHandle`, `StageControllerMethod`, `StageToolDefinition`, `StageToolRequestHandle`,
`CreateStageToolsOptions` and `CreateControllerStageToolsOptions`. They are the same functions the
root exports, so a handle created here works with tools built from the root.

Create the handle in a module both halves share. Your eager editor installs the controller on it
when it mounts, and the lazy assistant's tools call it:

```ts title="src/board-stage.ts"
import { createStageControllerHandle } from '@nntin/tinytinkerer-embed/stage'

type BoardController = { measure(input: unknown): { widthMm: number; heightMm: number } }

export const boardStage = createStageControllerHandle<BoardController>(
  'The board editor is not mounted.'
)
```

```ts title="src/editor.ts (eager)"
import { boardStage } from './board-stage'

boardStage.setController({ measure: () => ({ widthMm: 70, heightMm: 90 }) })
```

Until a controller is installed, `boardStage.request(...)` rejects with the message you passed,
and the model reads it as the tool's error.

## Configuration

`resolveBrowserShellBootstrapConfig(options)` returns the `BrowserShellConfig` that both
`createBrowserApp` and `BrowserAppShell` take.

| Option              | Meaning                                                                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`, `origin` | Required. Your app's base path and `window.location.origin`                                                                                                                                                                                                                      |
| `edgeBaseUrl`       | The TinyTinkerer edge, e.g. `https://api.tiny.nntin.xyz`. The edge must list your origin in `ALLOWED_ORIGINS`                                                                                                                                                                    |
| `storageNamespace`  | The IndexedDB database this app owns: conversations, settings, model choice. Use your own, e.g. `'canfactory'`. Never `'tinytinkerer'`, the product's own namespace, or two apps on one origin will share histories                                                              |
| `authMode`          | `'oauth'` (the app runs GitHub sign-in itself), `'host-token'` (the host supplies a token in `hostToken` and the app never starts OAuth), or `'hybrid'` (the default: OAuth, or the shared anonymous quota while signed out)                                                     |
| `githubClientId`    | The GitHub OAuth App's client id, for `'oauth'` and `'hybrid'`                                                                                                                                                                                                                   |
| `githubRedirectUri` | Where GitHub sends the user back: `${window.location.origin}${GITHUB_OAUTH_CALLBACK_PATH}` on an embedding host. Defaults to the hash route `<baseUrl>#/auth/callback` on your origin when only a client id is given                                                             |
| `theme`             | Optional colours mapped onto the shell's tokens, so the surface blends into your page: `{ background, panel, text, border, accent }`. Every field is optional; an omitted one keeps the shell's own value. A value may be `var(--your-token)`; see [Theme tokens](#theme-tokens) |
| `hostToken`         | A GitHub token the host already holds, for `'host-token'`. Kept in memory only                                                                                                                                                                                                   |
| `sentryDsn`, …      | Optional TinyTinkerer telemetry settings. Leave them unset unless you run the shell's telemetry                                                                                                                                                                                  |

## `createBrowserApp(config, options)`

`plugins` is the only required option. Every other option has a default that suits a page with
one assistant on it.

| Option               | Meaning                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins`            | Required. A function returning this app's plugins, usually `() => loadPlugins([...names])`. There is no default: name the subset you offer. `() => Promise.resolve([])` offers none                                                                                                                                                                                                                      |
| `appToolGroup`       | Your own always-on tools, as one `AppToolGroup` (`{ id, label, tools }`). They are registered in the runtime and shown in the tool picker as one group. They run in the runtime's tool-calling loop, which means the model reads each result before it picks the next call                                                                                                                               |
| `mcpServers`         | MCP servers the host provides, as `HostMcpServer[]` (`{ id, name, url, required? }`, no token). They are discovered at boot and their tools register as `mcp:<id>:<tool>`. They are not stored in the user's settings and are read-only there. The edge injects each server's token, so the browser never holds it. See [MCP integration](../plugins-and-tools/mcp-integration.md#host-provided-servers) |
| `appAssistantPolicy` | Your grounding and answer policy: `identity` (replaces the answer prompt's "You are tinytinkerer…" line, see [The assistant's identity](#the-assistants-identity)), instructions per boundary, and which links the transcript may render                                                                                                                                                                 |
| `starterPrompts`     | Suggestions shown on an empty conversation, before plugin or generic ones                                                                                                                                                                                                                                                                                                                                |
| `documentGlobals`    | Which document-wide effects this app owns. Omitted fields default to `true`. An embedding host passes `EMBEDDED_DOCUMENT_GLOBAL_CAPABILITIES`, which sets all four to `false`. See [Document globals](#document-globals)                                                                                                                                                                                 |
| `maxIterations`      | How many steps one chat turn may take (default 16). Every decision counts, the closing one included, so a ReAct turn makes at most `maxIterations` tool calls, then answers from what it has. Raise it for a long sequential MCP workflow. Values below 1 are raised to 1                                                                                                                                |
| `signIn`             | A host-provided sign-in action. Return `true` if the host started a sign-in. Omitted, the shell's own GitHub OAuth is the only route                                                                                                                                                                                                                                                                     |
| `toolTreeSummarizer` | The fallback tool-picker mapper. Pass `genericToolTreeSummarizer` with an `appToolGroup`, so the picker shows your tools even with the tool-tree plugin switched off                                                                                                                                                                                                                                     |
| `conversationReset`  | What the reset control does: `'clear-in-place'` (the default) or `'restart'`, which aborts the run and starts a fresh conversation                                                                                                                                                                                                                                                                       |
| `preSendDisclosure`  | A one-time notice that must be acknowledged before the first message is sent                                                                                                                                                                                                                                                                                                                             |
| `humanInput`         | Whether this app can ask its user a question in the middle of a run (default `true`). Set it to `false` if none of your tools or plugins asks, and the prompt renderer is never loaded                                                                                                                                                                                                                   |

### Document globals

Each of these writes to state there is only one of per page. Exactly one app on a page should own
each:

| Field                   | What it does when `true`                                                                                                                         | Embedding host |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `brandMetadata`         | Writes TinyTinkerer's favicon, manifest and `theme-color` into your `<head>`                                                                     | `false`        |
| `telemetry`             | Configures TinyTinkerer's Sentry telemetry, restores the user's consent at boot, and offers the consent toggle in Settings                       | `false`        |
| `contentRenderReporter` | Registers the sink that reports a renderer crash (a Mermaid diagram that throws, say) to that telemetry. Without telemetry it has nobody to tell | `false`        |
| `oauthCallbackWatchdog` | Arms a 10-second boot timer that reports to telemetry when a GitHub callback URL was never handled. Sign-in itself works without it              | `false`        |

So a host that runs no TinyTinkerer telemetry turns all four off:

```ts
import { createBrowserApp, EMBEDDED_DOCUMENT_GLOBAL_CAPABILITIES } from '@nntin/tinytinkerer-embed'

const app = createBrowserApp(config, {
  plugins,
  documentGlobals: EMBEDDED_DOCUMENT_GLOBAL_CAPABILITIES
})
```

### The assistant's identity

The answer prompt starts with "You are tinytinkerer, a warm, practical assistant." Set
`appAssistantPolicy.identity` to replace that line:

```ts
const app = createBrowserApp(config, {
  plugins,
  appAssistantPolicy: {
    identity: "You are CanFactory's assistant. You help people design perfboard circuits."
  }
})
```

It is one line: newlines become spaces, and a blank value keeps the default. The rest of that
prompt stays, because it describes what this UI can render. Your `instructions` for the `synthesis`
boundary are still appended after it. The planning and decision prompts state a role ("You are a
planning assistant…") rather than an identity, so `identity` leaves them alone; add to them with
`instructions`.

### Tools

A tool is `{ id, description, schema, execute }`, where `schema` is a Zod schema for the tool's
input. Write schemas with the package's exported `z`. Zod is compiled into the package, and the
runtime converts schemas to JSON Schema with that same copy. A schema from another Zod
installation would depend on two copies agreeing about each other's internals.

`createStageTools({ handle, methods })` builds the tool list from a request handle and a table of
methods, the way the Canvas, IDE and Mermaid stages do. Each method becomes a tool whose `execute`
calls `handle.request(method, input)`. See [Integrated application shells](./app-shell.md) for the
pattern.

Your tools are built before your editor mounts, so give them a handle to call instead of the editor
itself. `createStageControllerHandle<TController>(notMountedMessage)` returns one. Your editor calls
`handle.setController(controller)` when it mounts and `handle.setController(null)` when it unmounts.
Until then, every call rejects with `notMountedMessage`, and the model reads that as the tool's error:

```ts
import { createStageControllerHandle, createStageTools, z } from '@nntin/tinytinkerer-embed'

type EditorController = {
  getEditorState: (input: unknown) => Promise<unknown>
  setModelParameters: (input: unknown) => Promise<unknown>
}

export const editorHandle = createStageControllerHandle<EditorController>(
  'The editor is still loading'
)

const tools = createStageTools<EditorController>({
  handle: editorHandle,
  methods: {
    getEditorState: {
      description: "Read the editor's current model.",
      schema: z.object({}),
      outputSchema: z.object({ parts: z.array(z.string()) })
    },
    setModelParameters: {
      description: 'Change model parameters.',
      schema: z.object({ width: z.number().optional() })
    }
  }
})
```

- **Type-checked.** With a `StageControllerHandle`, the method table is checked against the
  controller: a key that isn't one of its methods is a type error. Name the controller explicitly,
  as above, and a method missing from the table is an error too.
- **Output schemas.** `outputSchema` is optional. When set, the runtime validates what the method
  returns before the model sees it, and a result that doesn't match fails the call.

#### Tool ids and collisions

The model sees your tools under their bare ids (`getEditorState`). Tools from MCP servers are
namespaced as `mcp:<server id>:<tool>`, so they never clash with yours. Plugin tools have bare ids
too, such as `web_search`, `ask_user`, `read_dom` and `run_javascript`.

Ids share one space, and the first tool registered under an id wins. Tools register in this order:

1. MCP servers: yours (`mcpServers`) first, then the user's.
2. Plugins.
3. Your `appToolGroup`.

So if one of your tools shares an id with an active plugin's tool, **the plugin's tool wins**, and
yours is dropped from every turn. The runtime logs
`[tinytinkerer] app tool "<id>" was dropped: a plugin or MCP tool already has that id` to the
console. Give your tools ids no catalogue plugin uses. A prefix, such as `canfactory_get_state`, is
the simplest way.

A plugin can't impersonate your tools to your policy either. Every result your
`appAssistantPolicy` sees carries a `source` the runtime stamps: `{ kind: 'app', groupId }` for your
tools, `{ kind: 'mcp', groupId: <server id> }` for MCP tools.

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
  edges list `kiprint.nntin.xyz` (production) and `kiprint-preview.nntin.xyz` (develop). While
  CanFactory production temporarily uses the develop edge, develop lists `kiprint.nntin.xyz` too. See
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

#### When a server is down

A failed discovery is recorded, not thrown. The server contributes no tools until it is discovered
again, and the user sees it in two places:

- **Settings → Tools.** The card shows the error and a **Retry** button.
- **The tool picker.** It lists your servers under "Provided by this app", read-only. A failed one
  reads `Unavailable: <error>` and has its own **Retry**.

Discovery otherwise reruns only when the token changes. So call `retryHostMcpDiscovery(app)` when
you know the server is back, for example from your own status banner. It resolves when discovery
settles and never rejects. For an app with no `mcpServers` it does nothing.

Mark a server the app depends on as `required: true`:

```ts
const mcpServers: HostMcpServer[] = [
  { id: 'kiprint', name: 'KiPrint', url: 'https://kiprint.nntin.xyz/mcp', required: true }
]
```

While a required server's tools are missing, every turn's system prompt ends with one line:
"Note: KiPrint is unavailable right now, so its tools are missing from this turn…". The tools
count as missing when discovery failed, is still running, or the user is signed out. The note tells
the model to say the server is unavailable rather than claim it used a tool. The note goes after
your `appAssistantPolicy` instructions at all three boundaries (planning, decision, synthesis). It
leaves out the discovery error, because that text comes from a remote server. Without `required`, a
down server shows only in the UI.

#### Rendering your own status

`app.stores.hostMcp` is a Zustand store, or `undefined` when you pass no `mcpServers`. Its state
is a `HostMcpState`:

| Field             | Meaning                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `servers`         | The `HostMcpServer[]` you passed                                                                                               |
| `discovery`       | The last discovery result per server id: `{ serverId, serverName, tools, syncedAt, error? }`. `error` is set when it failed    |
| `syncing`         | The ids of servers whose discovery is in flight. Every server starts here until the first discovery at boot settles it         |
| `discover(token)` | Rediscovers every server with `token`. Without a token it sends nothing and clears `discovery`. Prefer `retryHostMcpDiscovery` |

Inside `BrowserAppShell`, read it with `useHostMcp(selector)`. Outside React, use
`app.stores.hostMcp.subscribe`. `hostMcpServerStatus(state, id)` turns the state into one
server's status:

```tsx
import { hostMcpServerStatus, retryHostMcpDiscovery, useHostMcp } from '@nntin/tinytinkerer-embed'
import type { BrowserApp } from '@nntin/tinytinkerer-embed'

const KiPrintBanner = ({ app }: { app: BrowserApp }) => {
  const discovery = useHostMcp((state) => state.discovery)
  const syncing = useHostMcp((state) => state.syncing)
  const status = hostMcpServerStatus({ discovery, syncing }, 'kiprint')
  if (status.state !== 'unavailable') return null
  return (
    <p role="status">
      KiPrint is unavailable ({status.error}).{' '}
      <button onClick={() => void retryHostMcpDiscovery(app)}>Retry</button>
    </p>
  )
}
```

Select store fields, as above, and call `hostMcpServerStatus` outside the selector. It returns a
new object on every call, so used as the selector it would re-render without end.

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
call to action instead of the composer, and sends nothing to the edge. On load, in its eager entry,
the host checks `isGitHubOAuthCallback()` and calls `completeGitHubOAuth(config)` from the `/oauth`
subpath, then restores the URL it returns. It does so in a promise chain before rendering, not with a
top-level `await`, which can deadlock the entry. The whole flow, the edge's checks on it, and where
the token is stored are described in [GitHub sign-in for embedding hosts](./host-sign-in.md).

## `ChatApp` props

`storageKey` and `LoadingComponent` are required. `storageKey` is the base `localStorage` key for
the layout's size and position.

The layout is either uncontrolled or controlled:

- **Uncontrolled:** pass `mode` (`'floating'` or `'sidebar'`, default `'floating'`). ChatApp keeps
  the presentation itself and persists it under `storageKey`.
- **Controlled:** pass `presentation` (`{ mode, minimized, edge }`) and `onPresentationChange`
  together. ChatApp then persists no presentation of its own.

Mixing the two, or passing `presentation` without `onPresentationChange`, is a type error.

| Prop                                                     | Applies to | Meaning                                                                                                                                        |
| -------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `morphable`                                              | both       | Offers the dock/undock toggle and edge snapping (default `true`). A morphable docked panel is always resizable. Pass `false` to pin the layout |
| `side`                                                   | docked     | `'left'` or `'right'` (default `'right'`): the edge the dock button docks to, and the uncontrolled default                                     |
| `fill`                                                   | docked     | Fills the parent's height instead of the viewport's. Use it when the panel sits in a bounded region of your layout                             |
| `resizable`                                              | docked     | A resize handle on the panel. Ignored (always on) when `morphable`                                                                             |
| `sizeVariant`                                            | docked     | `'comfortable'` (default) or `'mobile'`, a full-bleed phone layout                                                                             |
| `framed`                                                 | floating   | Draws a rounded card around the conversation inside the window (default `false`)                                                               |
| `defaultWidth`, `defaultHeight`, `minWidth`, `minHeight` | floating   | The floating window's initial and minimum size, in pixels. Always clamped to the viewport, see [Size](#size)                                   |
| `overlay`                                                | floating   | Draws the window as a click-through overlay fixed to the viewport (default `false`), see [Floating over your page](#floating-over-your-page)   |
| `stageClassName`                                         | both       | An extra class on the layout's outer stage element, e.g. to position it or give the overlay a `z-index`                                        |
| `starterPrompts`, `starterPromptCount`                   | both       | Replace the app's `starterPrompts` on this surface, and how many to offer                                                                      |

A host that docks the assistant into its own pane, rather than over the page, passes
`mode="sidebar"`, `fill`, `morphable={false}` and the `side` it occupies:

```tsx
<div style={{ height: '100%' }}>
  <ChatApp
    storageKey="canfactory-assistant"
    LoadingComponent={Loading}
    mode="sidebar"
    side="right"
    fill
    morphable={false}
  />
</div>
```

### Floating over your page

By default the floating stage is an in-flow block at least `100vh` tall: the window is the page,
as on TinyTinkerer's own widget app. To draw it over a page of your own, pass `overlay`:

```tsx
<ChatApp storageKey="canfactory-assistant" LoadingComponent={Loading} mode="floating" overlay />
```

The stage is then `position: fixed; inset: 0; z-index: 30` and `pointer-events: none`. Clicks,
scrolling and hover outside the window reach your page. The window and the launcher that replaces
it while minimized stay interactive. You need no CSS of your own for this. To change the
`z-index`, add a `stageClassName` and a rule for it:
`.widget-stage.my-assistant-stage { z-index: 1000; }`. `overlay` has no effect on the docked
layout, so a morphable window that docks gets the ordinary in-flow pane.

### Size

The floating window opens at `defaultWidth` × `defaultHeight` (400 × 680 by default), and can't be
resized below `minWidth` × `minHeight` (320 × 420). Every size is clamped to the viewport, at
first paint, from a stored layout, and again whenever the viewport resizes:

- The window keeps a 24px margin on each side, so a 400px default opens 327px wide on a 375px
  phone. That's within `min(400px, 100vw - 32px)`, so don't pass a viewport-derived `defaultWidth`
  yourself.
- Where the viewport can't fit the minimum plus both margins, the margin shrinks first. Where it
  can't fit the minimum at all, the window shrinks below it rather than overflow.

The clamp is measured against the browser window, which is the stage's own box with `overlay`.
Without it, the window is placed in an in-flow stage, so keep that stage at the page's left and top
edges.

## Stylesheets

Load both stylesheets, and put the class `tt-app-embed` on the element that wraps the assistant:

- **`embed.css`** is the scoped baseline. It holds a scoped copy of Tailwind's preflight, the
  launcher, the answer prose styles and the token graph. Every rule is keyed on
  `:where(.tt-app-embed)`, so it changes nothing on your page outside the assistant.
- **`styles.css`** holds the component styles and design tokens, plus the Tailwind theme and
  utilities the components use, already compiled. Your app needs no Tailwind for them. If it does
  use Tailwind, it doesn't need to scan this package. The sheet has no global reset.

Neither sheet touches your page. Neither has a `:root` or `:host` selector, and the package build
fails if one appears. The design tokens, the Tailwind theme and `color-scheme: light` are declared
on the outermost `.tt-app-embed` element, at zero specificity, so any rule of yours wins.

`ChatApp`'s own stage element carries `tt-app-embed` too, so the docked and floating layouts are
covered even when they render outside your wrapper.

### Theme tokens

The surface's colour tokens are namespaced `--tt-*`, so they never collide with your own
variables:

- the bases: `--tt-bg`, `--tt-panel`, `--tt-text`, `--tt-muted`, `--tt-border`, `--tt-accent`,
  `--tt-link` and `--tt-accent-strong`;
- the values derived from them, such as `--tt-accent-ring` and `--tt-panel-hover`, which follow
  the bases automatically.

Your page's `--accent` stays yours. Because of the prefix, a `theme` value can reference one of
your variables. The surface then follows your theme live, including a dark-mode switch:

```ts
resolveBrowserShellBootstrapConfig({
  // ...
  theme: { accent: 'var(--accent)', panel: 'var(--surface)' }
})
```

`theme` sets the five bases it names. To set the others, such as `--tt-muted` or `--tt-link`, or to
change `color-scheme`, declare them on your wrapper: `.my-assistant.tt-app-embed { --tt-muted: …;
color-scheme: dark; }`.

#### Where the tokens land

Precedence, highest first: **the `theme` option > your CSS on the wrapper > the package's
defaults**. `theme` values are set inline on `ChatApp`'s inner stage element, not on your wrapper.

| Precedence | Source                                | Element                                                                                   | How                                                            |
| ---------- | ------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1          | `theme`                               | `ChatApp`'s inner stage element, `.widget-stage` or `.sidebar-stage`, inside your wrapper | An inline `style`, one `--tt-*` property per field set         |
| 2          | Your own CSS                          | Your wrapper, or wherever else your selectors match                                       | An ordinary rule                                               |
| 3          | The package's defaults (`styles.css`) | The outermost `.tt-app-embed`: your wrapper, or the stage if there's no wrapper           | `:where(.tt-app-embed:not(.tt-app-embed *))`, zero specificity |

The stage also carries `tt-app-embed`, and the derived values, such as `--tt-accent-ring`, are
declared again on every `.tt-app-embed`. So they're computed from the bases in force at the stage,
whichever source set them.

Why, for each base token:

1. **A `theme` field.** It's inline on the stage, so it beats any rule on your wrapper, and any
   ordinary rule on the stage itself. Only an `!important` declaration on the stage outranks it.
2. **Your CSS.** A rule on your wrapper, such as `.my-assistant.tt-app-embed { --tt-muted: #888; }`,
   is inherited by the stage. A rule that targets the stage (`.my-assistant .tt-app-embed`) also
   works.
3. **The package's defaults.** At zero specificity, any rule of yours wins over them.

**To let your CSS own a token, omit that field from `theme`.** Then declare the token on your
wrapper, for example per theme or per media query. To follow one of your own variables live
instead, set it in `theme` as `var(--your-token)`. It resolves at the stage, against what your page
has there.

### Assets

The package references its files (mermaid's runtime, the brand icons) with
`new URL('../assets/…', import.meta.url)`. Vite, Rollup and webpack recognise that pattern and
copy the files into your build output, so you don't copy anything by hand.

## Loading it lazily

The package is large; the chat surface, the runtime and their dependencies are most of a
deployable app. Load it behind a dynamic `import()`, for example with `React.lazy`. Your page then
pays nothing for it until the assistant is needed. Inside the package, plugins, renderers and
dialogs stay behind their own `import()`s, as separate chunks fetched only when used.

## A minimal host

```ts title="src/assistant-options.ts"
// Shared by the eager entry and the lazy assistant. Imports only the side-effect-free subpath.
import { GITHUB_OAUTH_CALLBACK_PATH } from '@nntin/tinytinkerer-embed/oauth'

export const assistantOptions = {
  edgeBaseUrl: 'https://api.tiny.nntin.xyz',
  storageNamespace: 'canfactory',
  githubRedirectUri: `${window.location.origin}${GITHUB_OAUTH_CALLBACK_PATH}`
}
```

```tsx title="src/main.tsx"
import { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { completeGitHubOAuth, isGitHubOAuthCallback } from '@nntin/tinytinkerer-embed/oauth'
import { assistantOptions } from './assistant-options'

// Nothing from the package root loads until this resolves.
const Assistant = lazy(() => import('./assistant'))

// GitHub redirects back here after sign-in. Finish it before anything renders.
const finishCallback = async (): Promise<void> => {
  if (!isGitHubOAuthCallback()) return
  const returnUrl = await completeGitHubOAuth(assistantOptions).catch(() => null)
  window.history.replaceState(null, '', returnUrl ?? '/')
}

// A promise chain, not a top-level await: see host-sign-in.md.
void finishCallback().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <Suspense fallback={null}>
      <Assistant />
    </Suspense>
  )
)
```

```tsx title="src/assistant.tsx"
import {
  BrowserAppShell,
  ChatApp,
  createBrowserApp,
  EMBEDDED_DOCUMENT_GLOBAL_CAPABILITIES,
  genericToolTreeSummarizer,
  loadPlugins,
  resolveBrowserShellBootstrapConfig,
  z,
  type AppToolGroup
} from '@nntin/tinytinkerer-embed'
import '@nntin/tinytinkerer-embed/embed.css'
import '@nntin/tinytinkerer-embed/styles.css'
import { assistantOptions } from './assistant-options'

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
  ...assistantOptions,
  authMode: 'oauth',
  githubClientId: '<the OAuth App client id>',
  theme: { accent: '#0f766e' }
})

const app = createBrowserApp(config, {
  plugins: () => loadPlugins(['plugin-tool-tree', 'plugin-context-usage']),
  appToolGroup: tools,
  toolTreeSummarizer: genericToolTreeSummarizer,
  starterPrompts: ['How big is a perfboard-70x90?'],
  documentGlobals: EMBEDDED_DOCUMENT_GLOBAL_CAPABILITIES,
  humanInput: false
})

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
then typechecks the host with `skipLibCheck: false` and builds it. The host's entry imports the
`/oauth` subpath eagerly and installs a stage controller from the `/stage` subpath at startup; its
tool answers through that handle. The run fails if the built host's gzipped startup JavaScript
grows past React plus a few kilobytes, which is what a runtime module leaking into it would cost.
The package build also fails if either subpath's own chunk graph grows past a few kilobytes.

The Playwright spec `packages/e2e/tests/embed-package.e2e.ts` serves that build and completes one
chat turn in which the model calls the host's Zod tool, through the real edge worker. The release
workflow runs the same install against each version right after publishing it.
