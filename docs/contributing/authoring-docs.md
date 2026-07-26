---
title: Authoring guide for /docs
sidebar_position: 2
---

# Authoring guide for /docs

A short, practical checklist for adding or changing a page under `/docs` (the Docusaurus site in
`apps/docs`, source content in this `docs/` directory). Read [Contributing](./CONTRIBUTING.md)
first for the terms that apply to any change; this page is about the docs site specifically.

## Adding a page

- Add a `.md` or `.mdx` file under the right `docs/<section>/` directory. The sidebar is
  auto-generated from the file tree (`apps/docs/sidebars.ts`), so no manual sidebar edit is
  needed.
- Give it frontmatter:

  ```md
  ---
  title: Your page title
  sidebar_position: 2
  ---
  ```

  `sidebar_position` controls ordering within its section; omit it only for a section's single
  landing page.

- A new top-level section needs a `_category_.json` next to it (see any existing one, e.g.
  `docs/architecture/_category_.json`) with a `label` and a `position`.
- Internal links are relative Markdown links to another file's path (see
  [Vercel deployment](../self-hosting/vercel-deployment.md)'s link to `litellm-setup.md` for an
  example), not hard-coded `/docs/...` URLs — `onBrokenLinks: 'throw'`/`onBrokenAnchors: 'throw'`
  (`apps/docs/docusaurus.config.ts`) fail the build at the source if one breaks, so use real
  relative paths and let the build catch typos.
- Mermaid diagrams are plain ` ```mermaid ` fences (`markdown.mermaid: true`); `pnpm check:mermaid`
  validates every fenced diagram in CI.

## Global MDX components

`apps/docs/src/theme/MDXComponents.tsx` registers a handful of components globally — usable in
any `.mdx` page with **no import**: `LiveLab`, `LiveSessionGate`, `LabReset`,
`RichContentPlayground`, `PixelAgentsLab`, `ExecutionTraceLab`, `PluginToolPickerLab`. See
[Interactive live labs (MDX framework)](../extending/interactive-labs.md) before building a new one
— every lab is a thin wrapper (stays free of any static import of the product runtime) around a
lazily-loaded `*Content` component, registered exactly like the ones above.

`LabContainer` (`apps/docs/src/components/lab-container.tsx`) is the shared
responsive/loading/warning/error/fullscreen shell every lab renders inside; it is **not** globally
registered (see `docs/index.mdx` for the explicit-import usage) since it is normally reached
through `LiveLab`, not used directly.

Adding a genuinely new reusable MDX component:

- Put it in `apps/docs/src/` (a new file, or alongside an existing lab/playground if it's part of
  that family) and add it to `MDXComponentsOriginal`'s spread in `MDXComponents.tsx` only if every
  docs page should be able to use it without an import — a one-off used on a single page doesn't
  need this, just import it directly in that page's `.mdx`.
- If it touches the product runtime (`@tinytinkerer/app-browser` or heavier), follow the
  `React.lazy` + `<BrowserOnly>` pattern documented on the interactive-labs page, and extend
  `apps/docs/src/live-lab/__tests__/static-safety.test.ts` (or the playground's sibling) with the
  same "stays light, only reaches its content via `React.lazy`" assertions — this is what the
  performance budget check (below) ultimately verifies against the real build.

## Screenshots and other assets

Docusaurus resolves relative image references in Markdown through its own asset pipeline (hashed,
webpack-processed) — no docs page currently ships any, but when one does: co-locate the image next
to the `.md`/`.mdx` file (or in a same-directory `img/` subfolder) and reference it as a normal
Markdown image with a relative path to that file, the same way an internal link above points at a
relative `.md` path. Don't add a generic `apps/docs/static/` folder for this — the two
`staticDirectories` entries in `docusaurus.config.ts` are reserved for the generated brand assets
and the Pixel Agents upstream bundle.

## Live-call disclosure

Every lab built on the `<LiveLab>` framework already shows a standing notice — "contacts the live
backend and may consume quota" (`live-lab/constants.ts`'s `DOCS_LAB_NETWORK_NOTICE`) — **before**
any protected content renders, and works anonymously against the shared, rate-limited key by
default (sign-in is an upgrade, never required). Don't build a lab that makes a live model/edge
call outside this framework; if a page needs to explain something about a live call that
`<LiveLab>`'s own notice doesn't cover, add it explicitly in that page's prose, near the embed —
never bury it below the fold or behind an interaction.

## Accessibility

- Prefer native elements (`<button>`, `<label>`, headings in order) over ARIA roles bolted onto a
  `<div>` — most of the framework's accessible names come from this for free.
- Muted/secondary text needs `var(--ifm-color-emphasis-700, var(--ifm-font-color-secondary))`, not
  `-600` — `custom.css` used to lean on `-600` everywhere, which measured under the WCAG AA 4.5:1
  minimum against this palette's light backgrounds (caught by the axe scans below).
- `docs/index.mdx`'s `LabContainer` demos each need their own distinguishable `title` — several
  landmarks (`<section aria-labelledby>`) sharing one name is itself an accessibility violation
  (axe's `landmark-unique`), not just a naming nicety.
- A build that reaches for `prismThemes.*`, a new lab, or any other syntax-highlighting/vendored
  theme should sanity-check contrast against this palette before adopting it wholesale.
- Avoid GFM task-list checkboxes (`- [ ]`) in prose checklists like this one — they render as a
  bare `<input type="checkbox" disabled>` with no accessible label; a plain bullet list reads just
  as well and doesn't fail axe's `label` rule.

## Testing

A change under `apps/docs/` or `docs/` is covered by, roughly narrowest to broadest:

- **Unit/component tests** (`apps/docs/src/**/__tests__/*.test.ts(x)`, Vitest): the live-session
  bridge's state machine, namespace isolation/reset behavior, and each lab's
  loading/signed-out/ready/error states, plus the `static-safety.test.ts` bundle-boundary checks
  above.
- **Playwright e2e** (`packages/e2e/tests/docs/*.e2e.ts`): real-browser coverage of navigation,
  deep links, refreshed routes, local search, responsive layouts, keyboard flows, the light/dark
  theme toggle, and each lab's stubbed (never live) agent run — see
  [Staging live-call smoke checklist](./staging-smoke-checklist.md) for the one thing e2e
  deliberately does **not** cover: an actual live model/edge call.
- **Accessibility** (`packages/e2e/tests/docs/accessibility.e2e.ts`): an `@axe-core/playwright`
  scan of every content page and lab, plus keyboard/focus/reduced-motion behavior axe itself can't
  assert. A new content page or lab should be added to this file's page/lab list.
- **Performance budget** (`pnpm check:docs-performance-budget`, wired into CI's Build task): fails
  if the live-lab product-runtime bundle ever becomes an eager dependency of an ordinary page —
  see `scripts/check-docs-performance-budget.mjs`.
- **Production build** (`turbo run build`, part of every CI run): a broken MDX import, internal
  link, anchor, or search-index build fails here, at the source.

Run the fast, targeted subset while iterating:

```bash
pnpm --filter @tinytinkerer/docs test     # unit/component
pnpm --filter @tinytinkerer/docs build    # production build + link/search checks
pnpm --filter @tinytinkerer/e2e e2e -- tests/docs/    # Playwright (needs `pnpm build` first)
```

## Review checklist

Before opening (or approving) a docs PR:

- `sidebar_position`/`_category_.json` set for a new page/section; internal links are relative
  Markdown links, not hard-coded URLs.
- Any new lab/component follows the `React.lazy` + `<BrowserOnly>` boundary and has a
  `static-safety.test.ts`-style test for it.
- A new lab uses `<LiveLab>`/`<LiveSessionGate>`/`<LabReset>` rather than a hand-rolled network
  call, and works signed-out.
- `apps/docs/src/**/__tests__` and `packages/e2e/tests/docs/` cover the new/changed
  loading/signed-out/error states and interaction paths (including `accessibility.e2e.ts` for a
  new page/lab).
- `pnpm --filter @tinytinkerer/docs build` and `pnpm --filter @tinytinkerer/e2e e2e -- tests/docs/`
  both pass locally.
- The PR's Vercel preview comment includes a working `/docs/` link — exercise the change there
  before merging.
