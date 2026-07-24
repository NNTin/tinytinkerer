---
title: Interactive live labs (MDX framework)
---

# Interactive live labs (MDX framework)

Docs pages can embed a live, working TinyTinkerer demo directly in their content via three
globally-registered MDX components — `LiveLab`, `LiveSessionGate`, and `LabReset` — implemented
in `apps/docs/src/live-lab/` and registered in `apps/docs/src/theme/MDXComponents.tsx`. This page
documents the framework itself; the content of any specific lab is out of scope here.

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

See also:

- [content-platform.md](./content-platform.md)
- [PRIVACY.md](./PRIVACY.md) — telemetry/consent behavior is reused unchanged (`BrowserAppShell`'s
  consent gates run inside the docs session too)
