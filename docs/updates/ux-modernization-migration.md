---
unlisted: true
---

# UX Modernization — Migration Notes

This change set upgrades the shared chat experience across the web, mobile, and
widget shells. Almost everything lands in shared packages (`app-browser`,
`app-core`, `contracts`, `ui`); the shells only wire it up. This document records
the **contract changes** and how to adopt them.

## 1. `rerunLastPrompt` — regenerate capability (app-core + app-browser)

- **`@tinytinkerer/app-core`** adds a pure helper:

  ```ts
  latestUserPrompt(events: ChatEvent[]): string | undefined
  ```

  It returns the text of the most recent `user.message` event (or `undefined`).

- **`app-browser` chat store** (`ChatState`) gains:

  ```ts
  rerunLastPrompt: () => Promise<void>
  stop: () => void
  ```

  `rerunLastPrompt` re-runs the latest user prompt through the normal send path,
  so it re-checks the cooldown/running gate and **appends a fresh generation,
  preserving the existing conversation history** (it does not mutate or truncate
  prior turns). `stop` aborts the in-flight run via the same `AbortController`
  path as `cancelRetry`.

- **`useChatSurfaceController`** now exposes `stop`, `rerunLastPrompt`, and
  `canRerun` (true when there is a user turn and the surface is idle).

**Adopting:** consumers of `useChatSurfaceController` get the new fields for
free. Tests that mock the controller must add `stop`, `rerunLastPrompt`, and
`canRerun` to their mock object.

## 2. `PluginManifest.starterPrompt` (contracts)

```ts
export type PluginManifest = {
  // …
  starterPrompt?: string
}
```

Optional, backward-compatible. A plugin may contribute a one-line cold-start
suggestion that the host surfaces in the empty-state starter prompts **only when
the plugin is enabled** (so a disabled plugin never advertises a capability the
assistant cannot use). This follows the existing manifest-descriptor pattern
(`summarizeActivity`, `statusDescriptor`, …) so the host stays free of any
concrete plugin id. Shipped on `plugin-web-search`, `plugin-code-exec`, and
`plugin-browser-state`.

**Adopting:** no action required for existing plugins. New plugins may set
`starterPrompt` to appear in the onboarding suggestions.

## 3. Host theme injection (app-browser config + shell embedding contract)

```ts
export type ShellThemeTokens = {
  background?: string
  panel?: string
  text?: string
  border?: string
  accent?: string
}
```

`BrowserShellConfig` / `ResolvedBrowserShellConfig` gain an optional `theme?:
ShellThemeTokens`, resolved from the existing
`window.__TINYTINKERER_SHELL_CONFIG__` embedding key. An embedding page can now
pass:

```js
window.__TINYTINKERER_SHELL_CONFIG__ = {
  // …existing fields…
  theme: {
    background: '#101014',
    panel: '#1b1b22',
    text: '#e7e7ea',
    border: '#2a2a31',
    accent: '#7c5cff'
  }
}
```

`shellThemeToCssVars(theme)` maps these onto the shell's CSS custom properties
(both the generic `--bg/--panel/--text/--border/--accent` tokens and the
widget-specific `--widget-*` tokens). The widget applies the result to its stage
element.

The design tokens are defined **once** in `@tinytinkerer/app-browser`, so the
three shells no longer keep their own copies and cannot drift. Overriding the
base tokens — a host theme, or a `prefers-color-scheme` dark mode — recolors the
conversation surface in one shot, with no per-component change. Fixed semantic
colors (the notice/warning banners and destructive-action hovers) intentionally
stay put.

> **Two corrections since this was written.**
>
> **Where they live.** #491 split the file: `tokens.css` declares the base
> palette on `:root`; `token-graph.css` declares the _derived_ tokens —
> `--text-strong`, `--panel-hover`, `--accent-ring`, `--accent-soft`,
> `--user-bubble` — as `color-mix` expressions over it, for `:root` **and**
> `:where(.tt-app-embed)`. The second scope is load-bearing, not a convenience: a
> custom property is computed where it is _declared_, so a graph declared only on
> `:root` mixes against the root's bases and hands that result down even to a
> subtree that overrode them.
>
> **The list below it was incomplete, and that mattered.** This paragraph
> enumerated the components carrying "no literal palette values" — message
> bubbles, `TurnChrome`, `ConversationEmptyState`, `JumpToLatestButton`, the
> tabbed settings. `DockedChatSurface` and `TurnActivityPanel` were conspicuously
> absent from it, and they were absent because they had not been converted: 69
> literal `stone-*`/`white` classes between them. Reading the list as "the
> conversation surface reads only tokens" is how the gap stayed invisible for
> four issues, until a host with a real dark mode (the documentation, #480) put a
> white composer on a near-black page. Both were converted in #496; the claim is
> now true of the whole conversation surface.

## 4. New shared exports (app-browser)

These are additive; no existing export changed signature:

- `useStickToBottom`, `StickToBottom` — smart auto-scroll hook (Q2).
- `JumpToLatestButton` — the "↓ New messages" pill (Q2).
- `TurnChrome`, `TurnActions`, `deriveTurnStatus` — shared assistant-message
  boundary with copy/collapse/regenerate actions and the live status line
  (C3/B1/C2).
- `ConversationEmptyState`, `useStarterPrompts` — data-driven onboarding (B3).
  (`deriveStarterPrompts` is the pure helper behind the hook; it stays internal
  to `conversation-empty-state.tsx` and is not exported.)
- `SettingsPanel` (+ `SettingsPanelProps`, `SettingsPanelPresentation`) and
  `LazySettingsPanel` — the tabbed settings surface with `presentation="modal"`
  (web/mobile) or `"inline"` (widget) (B2). `BrowserSettingsModal` is retained
  as a thin modal-presentation alias, so existing callers and
  `LazyBrowserSettingsModal` are unaffected.
- `shellThemeToCssVars`, `ShellThemeTokens` (B4).

## 5. `@tinytinkerer/ui`

Adds the `FaStop` icon used by the new Stop-generation control.
