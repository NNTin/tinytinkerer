---
sidebar_position: 2
title: Build a content renderer
---

# Build a content renderer

This is a task-oriented walkthrough, not a reference — it builds one small, real renderer (a
`> [!SPOILER]` blockquote that hides its content behind a disclosure toggle) end to end. For the
full package model, the AST, and the two extension scenarios, see
[Content platform](./content-platform.md); this page links back into it instead of repeating it.

**Learning objective:** ship a new specialized renderer for an **existing** AST node type
(scenario 1 in [Adding a Renderer Package](./content-platform.md#adding-a-renderer-package)) and
see it render through the real chat surface and the rich content playground, with no change to
`@tinytinkerer/contracts` or the markdown parser.

## Before you start

- A local clone of the repo with `pnpm install` already run.
- `[!SPOILER]` reuses the `blockquote` AST node markdown already produces — the same node type
  `content-callout`'s `[!NOTE]`/`[!TIP]`/etc. renderer specializes. This tutorial is deliberately
  the same shape as that shipped plugin, so read its source
  (`packages/content/renderers/content-callout/src/index.tsx`) alongside this page.

## 1. Scaffold the package

Create `packages/content/renderers/content-spoiler/package.json`:

```json
{
  "name": "@tinytinkerer/content-spoiler",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./src/index.tsx",
      "default": "./src/index.tsx"
    }
  },
  "main": "src/index.tsx",
  "types": "src/index.tsx",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "eslint src",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@tinytinkerer/content-react": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  }
}
```

and `packages/content/renderers/content-spoiler/tsconfig.json`:

```json
{
  "extends": "../../../../config/tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx"
  },
  "include": ["src", "tests"]
}
```

`pnpm-workspace.yaml` already globs `packages/content/renderers/*`, so no workspace configuration
changes are needed.

## 2. Write the plugin

`packages/content/renderers/content-spoiler/src/index.tsx`:

```tsx
import { Fragment } from 'react'
import type { BlockquoteNode, ReactNodeRendererPlugin } from '@tinytinkerer/content-react'

// Matches `> [!SPOILER]` as the blockquote's entire first line — deliberately
// simpler than content-callout's marker-plus-remaining-text handling, since this
// renderer hides everything after the marker rather than continuing it inline.
const isSpoilerMarker = (node: BlockquoteNode): boolean => {
  const first = node.children[0]
  if (!first || first.type !== 'paragraph') return false
  const onlyChild = first.children.length === 1 ? first.children[0] : undefined
  return onlyChild?.type === 'text' && onlyChild.value.trim().toUpperCase() === '[!SPOILER]'
}

export const spoilerPlugin: ReactNodeRendererPlugin<'blockquote'> = {
  id: 'spoiler',
  nodeType: 'blockquote',
  // Higher than content-react's default blockquote plugin (priority 0) and lower
  // than nothing else claims this node type today — bump if a future plugin also
  // specializes `blockquote` and needs to win first.
  priority: 25,
  matches: isSpoilerMarker,
  render: (node, ctx) => (
    <details className="tt-spoiler">
      <summary>Spoiler — click to reveal</summary>
      {node.children.slice(1).map((child) => (
        <Fragment key={child.id}>{ctx.renderBlock(child)}</Fragment>
      ))}
    </details>
  )
}
```

This is Scenario 1 from [Adding a Renderer Package](./content-platform.md#adding-a-renderer-package):
`blockquote` already exists in the canonical content model, and `content-react` already ships a
default plugin for it, so `matches()` plus a higher `priority` is all a specialization needs — no
change to `@tinytinkerer/contracts` or `content-markdown`. Three things worth noticing:

- `render(node, ctx)` recurses into child blocks via `ctx.renderBlock`, the same `RenderContext`
  every renderer plugin receives — never a hand-rolled recursive render function.
- There is no `fallback()` here because this plugin can't fail: it does no lazy loading and no
  external runtime. A plugin that loads something (like Mermaid) implements `fallback(node,
failure)` to degrade to `CodeBlockFallback` instead of breaking the page — see
  [Content platform](./content-platform.md#reusing-the-chrome).
- Nothing here imports from `@tinytinkerer/content-core` directly — only from
  `@tinytinkerer/content-react`, which re-exports the AST types a renderer package needs.

## 3. Verify it locally

```bash
pnpm install
pnpm --filter @tinytinkerer/content-spoiler typecheck
```

There's no boundary-checker entry needed until you wire it into `app-browser` (next step) — until
then this package only depends on `content-react`, which is already an allowed dependency for a
`content-*` renderer.

## 4. Wire it into the assistant surface

Add it to the stable plugin array in
`packages/app/app-browser/src/assistant-content.tsx`:

```ts
import { spoilerPlugin } from '@tinytinkerer/content-spoiler'

export const assistantContentPlugins: readonly ReactContentPlugin[] = [
  mermaidPlugin,
  wireframePlugin,
  codePlugin,
  calloutPlugin,
  linkCardPlugin,
  imagePlugin,
  tablePlugin,
  spoilerPlugin
]
```

and add `@tinytinkerer/content-spoiler` as a workspace dependency of `@tinytinkerer/app-browser`.
Apps and shells need no other change — every browser shell already renders assistant content
through this one array.

## 5. Try it

```bash
pnpm dev
```

Because the [rich content renderer playground](./rich-content-playground.mdx) spreads the exact
same `assistantContentPlugins` array (`...assistantContentPlugins` in
`packages/app/app-browser/src/content-playground.tsx`), the fastest way to see this working is
that playground rather than a real chat turn:

```markdown
> [!SPOILER]
> The wizard was Gandalf all along.
```

**Expected outcome:** the "Semantic document (AST)" panel shows a `blockquote` node resolved to the
`spoiler` plugin (not `content-react`'s default blockquote renderer), and the preview shows a
closed disclosure toggle labeled "Spoiler — click to reveal" that expands to the hidden paragraph
on click.

## Troubleshooting

| Symptom                                                                    | Likely cause                                                                                                                                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blockquote still renders as a plain quote                                  | `matches()` didn't fire — check the marker is the blockquote's first paragraph and nothing else on that line.                                                                       |
| AST panel shows the block resolved to a different plugin                   | Another plugin's `priority` is higher, or its own `matches()` also returns `true` for this node — narrow one of the two predicates.                                                 |
| `pnpm --filter @tinytinkerer/content-spoiler typecheck` fails on an import | The package imported from `@tinytinkerer/content-core` directly instead of the `content-react` re-export — see [Content platform](./content-platform.md#tinytinkerercontent-react). |
| Renderer works in the playground but not in chat                           | The plugin was added to the playground's array but not `assistantContentPlugins` in `assistant-content.tsx` (the playground extends that array, not the other way around).          |

## Next step

- Adding a genuinely **new** AST node type instead of specializing an existing one is Scenario 2 —
  see [Adding a Renderer Package](./content-platform.md#adding-a-renderer-package) for the extra
  steps (extend `@tinytinkerer/contracts`, teach `content-markdown` to emit it).
- [Live agent execution trace lab](./execution-trace.mdx) shows how rendered content fits into a
  full run alongside planning and tool calls.
