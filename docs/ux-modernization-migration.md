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

The design tokens are defined **once** in
`@tinytinkerer/app-browser/styles.css` (imported by every shell before its own
`index.css`), so the three shells no longer keep their own copies and cannot
drift. That file also defines the _derived_ tokens — `--text-strong`,
`--panel-hover`, `--accent-ring`, `--accent-soft`, `--user-bubble` — as
`color-mix` expressions over the base tokens. The shared conversation surface
(message bubbles, `TurnChrome`, `ConversationEmptyState`, `JumpToLatestButton`,
the tabbed settings) carries **no literal palette values**; it reads only these
tokens. So overriding the base tokens — a host theme today, a
`prefers-color-scheme` dark mode tomorrow — recolors the whole conversation
surface in one shot, with no per-component change. Fixed semantic colors (the
notice/warning banners and destructive-action hovers) intentionally stay put.
This is host-adaptation; it is **not** itself a full dark mode, but it is the
mechanism a dark mode would reuse.

## 4. New shared exports (app-browser)

These are additive; no existing export changed signature:

- `useStickToBottom`, `StickToBottom` — smart auto-scroll hook (Q2).
- `JumpToLatestButton` — the "↓ New messages" pill (Q2).
- `TurnChrome`, `TurnActions`, `deriveTurnStatus` — shared assistant-message
  boundary with copy/collapse/regenerate actions and the live status line
  (C3/B1/C2).
- `ConversationEmptyState`, `useStarterPrompts`, `deriveStarterPrompts` — data
  -driven onboarding (B3).
- `SettingsPanel` (+ `SettingsPanelProps`, `SettingsPanelPresentation`) and
  `LazySettingsPanel` — the tabbed settings surface with `presentation="modal"`
  (web/mobile) or `"inline"` (widget) (B2). `BrowserSettingsModal` is retained
  as a thin modal-presentation alias, so existing callers and
  `LazyBrowserSettingsModal` are unaffected.
- `shellThemeToCssVars`, `ShellThemeTokens` (B4).

## 5. `@tinytinkerer/ui`

Adds the `FaStop` icon used by the new Stop-generation control.
