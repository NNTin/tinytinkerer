# UI/UX Concept — tinytinkerer

This document records the design intent behind the current UI so future agents can extend it consistently.

## Style direction

The palette is warm stone and amber: `--bg` (#f6f2ec), `--panel` (#fffaf5), `--border` (#dccdb9), `--muted` (#766a5d), amber-400/500 for interactive focus and accent. The overall effect is editorial and calm, not saturated or high-contrast. Avoid introducing blues, purples, or vivid accent colours that would break this tone.

Typography uses Inter at default weights. Headings inside panels are `text-xs font-medium uppercase tracking-wider text-[var(--muted)]` — small, quiet labels that orient without dominating. Never use large headings or hero text on the main page.

Borders and shadows are used sparingly to indicate hierarchy:
- Primary panel (conversation): `shadow-sm` + `border border-[var(--border)]` + `bg-[var(--panel)]`
- Secondary panels (thinking, tools): no shadow + `bg-[var(--bg)]` + lighter border
- Composer: `shadow-sm` + `bg-[var(--panel)]`, visually paired with the conversation panel

## Layout

The page is a single full-height column (`h-screen`, `overflow-hidden`, `max-w-5xl mx-auto`). Sections stack vertically inside a `<main>` with a small gap (`gap-3`). There is no sticky top bar or global nav — the settings gear lives inside the composer so controls stay close to where they are used.

```
┌──────────────────────────────────────┐
│  Conversation (flex-1, scrollable)   │
├──────────────────────────────────────┤
│  Thinking timeline (conditional)     │  ← secondary, lighter
├──────────────────────────────────────┤
│  Tool activity    (conditional)      │  ← secondary, lighter
├──────────────────────────────────────┤
│  Composer (textarea + actions)       │
└──────────────────────────────────────┘
```

The conversation panel takes `flex-1` and all available height. Secondary panels are fixed-height and shrink to fit their content. When both secondary panels are disabled in settings the page is just conversation + composer, which is the baseline clean state.

## Conversation panel

The dominant surface. White-ish background (`--panel`), shadow, generous padding. User messages render as warm amber-tinted bubbles. Assistant messages render on a white card. Error and system messages use colour-coded borders (rose, amber, stone). Streaming uses a blinking amber cursor.

Do not add sidebars, split panes, or competing surfaces at the same visual weight as the conversation.

## Composer

Sits at the bottom of the column. Contains a growing textarea and an action row:
- **Left**: settings gear (tertiary, icon-only), "Sign in" button (tertiary, icon+label, shown only when unauthenticated)
- **Right**: Reset (secondary, labelled button), Cancel retry (secondary, conditional), Send (primary CTA, min-w-24)

Action hierarchy: Send is the single primary action. Reset and Cancel are secondary. Settings and Sign in are tertiary. Never place a primary CTA next to another primary CTA.

The "Sign in" button is the primary auth entry point. It appears in the composer action row only when the user is not authenticated, giving immediate discoverability without cluttering the main page. Clicking it opens the Settings modal (Auth section), which handles both GitHub OAuth and PAT flows. Once signed in, the button disappears.

## Settings modal

Settings live in a Radix Dialog, opened via the settings gear. This keeps the main page uncluttered and lets settings feel like a deliberate mode change. The modal is `max-w-md`, centred, with a header / scrollable body layout.

Inside the modal, sections are separated by `<hr>` dividers with `SectionHeading` labels (`text-xs uppercase tracking-wider`). Each section has a single responsibility (Auth, Models, Search, Interface). Auth, Models, and Search each surface their live service status inline inside the section so the top-level app chrome can stay quiet without hiding system health. Toggle rows use the `ToggleRow` primitive with a custom amber toggle control.

Do not put settings inline on the main page. Do not add floating panels or drawer overlays for settings.

## Secondary panels (Thinking / Tool History)

Thinking timeline and Tool History are opt-in transparency features, not primary content. They must always feel subordinate:

- Use `bg-[var(--bg)]` (not `--panel`) so they sit one step behind the conversation.
- No `shadow-sm` — shadows are reserved for primary panels.
- Reduced padding (`px-4 py-3` vs `p-5` for the conversation).
- Headings at `text-xs font-medium` — quieter than primary panel headings.
- Timeline entries: compact rows with a small step-number badge, no card borders.
- Tool history entries: `text-xs`, muted colours, `<details>` for expandable output.

The two panels have different time scopes:
- Thinking timeline is current-turn only. It explains the active run and resets naturally with the next user prompt.
- Tool History is conversation-level. It acts as a historical audit log and may include entries from earlier turns in the same conversation.

Both panels are conditionally rendered based on their persisted toggle in settings (`showThinkingTimeline`, `showToolActivity`). When disabled, the section is completely removed from the DOM — no empty placeholder, no skeleton.

## Adding new UI

Follow these rules when introducing new elements:

1. **Every new control needs a home**: composer action row for send-adjacent actions, settings modal for preferences, inline inline inline for contextual actions inside a message.
2. **Match the visual tier**: primary surfaces get `--panel` + shadow; secondary surfaces get `--bg`, no shadow.
3. **Keep the palette warm**: amber for interactive focus/accent, stone for text, no cold blues.
4. **No orphan panels**: don't add a new panel on the main page without gating it behind a settings toggle and making it visually secondary.
5. **Mobile first**: the layout is a single column. New sections must stack cleanly without horizontal overflow on narrow screens.
