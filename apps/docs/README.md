# TinyTinkerer documentation app

This workspace builds the repository's root [`docs/`](../../docs) directory with Docusaurus and
is composed into the main frontend at `/docs/`.

The package intentionally does not set `"type": "module"`. Docusaurus generates a
`.docusaurus/registry.js` module that uses webpack's CommonJS `require.resolveWeak` transform
during its server build. Marking this package as ESM makes webpack leave that generated call for
Node to execute during static rendering, where it fails because Node's `require` has no
`resolveWeak` method. The TypeScript Docusaurus configuration and application source still use
ES modules.

## Information architecture

Docs live under one top-level category folder per audience journey: `overview`,
`using-tinytinkerer`, `plugins-and-tools`, `extending`, `self-hosting`, `architecture`,
`contributing`. Each has a `_category_.json` (`label` + `position`, controlling sidebar order)
and an `index.md` landing page (`id: index`) that explains who the section is for and links to a
next step — Docusaurus automatically uses a folder's `index.md` as that category's own sidebar
link.

Conventions for new docs:

- Set `sidebar_position` in frontmatter when a folder has more than one content doc, so order is
  explicit rather than alphabetical.
- Docs that shouldn't appear in navigation (policy/update notices like `docs/updates/*`) get
  `unlisted: true` in frontmatter instead of being left out of the build — they stay reachable by
  direct URL, just out of the sidebar and search index.
- `docs/overview/PRIVACY.md` and `docs/updates/PRIVACY-UPDATE.md` are also read verbatim by
  `scripts/generate-privacy-policy.mjs` into the in-app privacy dialog. That script strips
  frontmatter before embedding, but avoid adding content above the first heading in those two
  files beyond frontmatter.
- Breadcrumbs and prev/next pagination are on by default in the classic preset and derive from
  this folder structure and `sidebar_position` — no per-doc configuration needed.
- Link to other docs with relative paths (`../architecture/ARCHITECTURE.md`); `onBrokenLinks:
'throw'` in `docusaurus.config.ts` fails the build on a broken one. A same-origin link that
  leaves the docs router entirely (e.g. back to the product) needs the `pathname://` protocol
  (see `docs/index.mdx`) so Docusaurus doesn't try to resolve it as a doc route.
- Distinguish **concept/reference** docs (e.g. `plugin-infrastructure.md`,
  `content-platform.md`) from **task-oriented tutorials** (`build-a-plugin.md`,
  `build-a-renderer.md`) and **live labs** (`*-lab.mdx`, `execution-trace.mdx`,
  `rich-content-playground.mdx`). A tutorial builds one small, real thing end to end with runnable
  code and a troubleshooting table, then links back into the concept doc instead of duplicating
  it; it doesn't need to re-teach the full contract. A live lab opens with a one-line "Learning
  objective" and follows the interaction with an explanation of what was actually observed.

Run the documentation site through the unified root development command:

```sh
pnpm dev
```

The standalone Docusaurus server remains available for focused authoring:

```sh
pnpm --filter @tinytinkerer/docs dev
```
