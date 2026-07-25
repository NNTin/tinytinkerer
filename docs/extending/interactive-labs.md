---
title: Interactive live labs (MDX framework)
---

# Interactive live labs (MDX framework)

Docs pages can embed a live, working TinyTinkerer demo directly in their content via
globally-registered MDX components — `LiveLab`, `LiveSessionGate`, `LabReset`, and the
ready-made `PixelAgentsLab` — implemented in `apps/docs/src/live-lab/` and registered in
`apps/docs/src/theme/MDXComponents.tsx`. This page documents the framework itself and its one
built-in lab; the content of any OTHER specific lab built from the primitives below is out of
scope here.

## Using it in an `.mdx` page

```mdx
<LiveLab title="Try the ReAct planner">
  <LiveSessionGate>
    {/* Rendered only once the isolated docs session is signed in and ready.
        Use the normal product hooks (useChatStore, useSettingsStore, ...) from
        @tinytinkerer/app-browser here to drive the actual demo. */}
    <MyLabContent />
  </LiveSessionGate>
  <LabReset />
</LiveLab>
```

- **`LiveLab`** is the client-only boundary. It renders nothing during a static build (via
  Docusaurus's `<BrowserOnly>`) and lazy-loads the product runtime only when it mounts in a
  browser, so pages without a lab never download it. It also shows a standing notice that the
  lab contacts the live backend before any protected content can render.
- **`LiveSessionGate`** standardizes the `loading` / `signed-out` / `ready` / `running` /
  `rate-limited` / `error` / `reset` states. It renders `children` only for `ready`/`running`;
  every other state gets a sensible default (including a "Sign in with GitHub" call to action),
  overridable per status via props.
- **`LabReset`** is a visible button that clears the lab's own isolated session — never the main
  product's database or auth token — and reloads the page.
- **`useLabSession()`** (importable from `../live-lab` within the docs app) gives lab content the
  live snapshot plus `signIn`/`reset`, for labs that want custom UI instead of `LiveSessionGate`'s
  defaults.

## How isolation works

- **Auth token:** read-only, same-origin reuse. The framework peeks the product's own default
  IndexedDB token store and passes it into the docs session as a `hostToken` — it is never
  written back, so it never lands in the docs-only database.
- **Everything else** (conversations, plugin settings, model selection) is stored under a
  separate IndexedDB database (`tinytinkerer-docs-lab`, see `live-lab/constants.ts`), completely
  isolated from the product's own `tinytinkerer` database.
- **Sign-in** hands off to the product's own GitHub OAuth flow (not a docs-local one) and returns
  the visitor to the exact docs URL they started from.
- **Multiple labs on one page** share a single underlying session: the `BrowserApp` instance is a
  module-level singleton (`ensureDocsLabApp` in `client-runtime.tsx`), created at most once per
  page load.
- **Edge/GitHub-OAuth config** (`edgeBaseUrl`, `githubClientId`, ...) is baked into the page at
  Docusaurus build time from the same `VITE_*` env vars the product's own Vite builds already
  read, via `docusaurus.config.ts`'s `customFields` (see `site-config.ts`'s
  `resolveDocsLabCustomFields` and `live-lab/runtime-config.ts`).

## The built-in lab: `PixelAgentsLab`

`PixelAgentsLab` is a ready-made, fully-composed lab — drop it into any `.mdx` page with no
further wiring:

```mdx
<PixelAgentsLab title="Try Pixel Agents" />
```

It uses Pixel Agents (the same animated pixel-art office the main product renders at
`/pixel-agents`, via `@tinytinkerer/pixel-agents`'s `PixelAgentsStage`) as the visual surface for
managing several demo conversations at once:

- Every demo conversation the visitor creates becomes its own office character, with its
  active/running/tool-active/completed/failed/awaiting-input state driven by the same
  `ChatEvent` stream and Pixel Agents projection the main product uses (`activity.ts`'s
  `messagesForChatEvent`/`conversationActivityStatus`) — there is no docs-only event protocol.
- Creating, selecting, and deleting conversations here only ever touches the docs session's own
  isolated chat store (see "How isolation works" above); a visitor's real conversations in the
  product are never read or affected.
- A compact, always-present, fully keyboard/screen-reader-operable text list (native buttons, no
  custom ARIA widgets) sits alongside the office and lets a visitor manage every conversation the
  same way. It becomes the ONLY surface — instead of a half-working graphical one — on a narrow
  viewport, for a `prefers-reduced-motion` visitor, or if the Pixel Agents iframe/asset bundle
  fails to bootstrap (`usePixelAgentsCapability`, `pixel-agents/capability.ts`).
- The office's own upstream assets/bootstrap bundle are resolved as an ABSOLUTE URL against the
  site's own base path (`pixel-agents/upstream-url.ts`, via `PixelAgentsStage`'s
  `resolveUpstreamUrl` prop), not relative to the current page — needed because, unlike the
  product's own `/pixel-agents` route, a docs page embedding this lab can sit at any nested route
  under `/docs/**`. The bundle itself is the exact one `apps/pixel-agents` already builds
  (`pnpm -w prepare:pixel-agents`, served from `${baseUrl}upstream/**` via
  `docusaurus.config.ts`'s `pixelAgentsUpstreamDir` static directory) — docs does not fetch or
  build a second copy.
- The office's own workspace persistence (agent seats/palette, dock layout) is namespaced to a
  docs-only IndexedDB database and localStorage key (`PixelAgentsStage`'s
  `workspaceDatabaseName`/`dockLayoutStorageKey` props — see `pixel-agents/constants.ts`), so it
  never collides with, or overwrites, a visitor's real Pixel Agents workspace on the same origin.

<PixelAgentsLab title="Try Pixel Agents" />

See also:

- [content-platform.md](./content-platform.md)
- [PRIVACY.md](../overview/PRIVACY.md) — telemetry/consent behavior is reused unchanged
  (`BrowserAppShell`'s consent gates run inside the docs session too)
- [Rich content renderer playground](./rich-content-playground.mdx) — a sibling MDX framework for
  a client-side-only demo (parsing and rendering, no backend session) built on the same
  `<BrowserOnly>` + `React.lazy` isolation pattern this page documents
