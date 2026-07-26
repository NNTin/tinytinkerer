# Documentation retrieval (search) adapter

`searchDocumentation` (search-documentation.ts) exposes Docusaurus' local
search — currently the pinned `@easyops-cn/docusaurus-search-local@0.55.2`
plugin — as a small, stable TinyTinkerer retrieval API for assistant tools.
`#471` deliberately uses this local search system rather than a vector
database/RAG service; this module is the compatibility boundary TinyTinkerer
owns around it, so a plugin upgrade can change its private format without any
tool or UI noticing.

## Module boundary

- `private-index-adapter.ts` is the **only** file that imports
  `@easyops-cn/docusaurus-search-local` internals. It fetches and validates
  the plugin's raw `search-index.json`, queries the loaded lunr indexes, and
  returns a small neutral shape (`PrivateIndexSearchHit`) — never the
  plugin's abbreviated document fields (`i`/`t`/`u`/`p`/`h`/`s`/`b`).
- `corpus-ref-map.ts` maps a hit's page URL to a `#474` corpus ref via the
  documentation corpus's own manifest (`docs-corpus/plugin.ts`,
  `docs-corpus/build-corpus.ts`). It knows nothing about the search plugin.
  The manifest now emits every loaded Docusaurus version, so the lookup only
  considers `isLast: true` entries — the pinned search index only ever
  indexes that canonical version's pages.
- `search-documentation.ts` composes the two into
  `DocumentationSearchResponse`
  (`packages/shared/contracts/src/documentation-search.ts`): it deduplicates
  raw hits down to one result per page (keeping the best-scoring section),
  drops results that don't map to a listed `#474` document, enforces the
  requested result limit, and builds bounded, safe snippets.

Nothing outside this directory should import `private-index-adapter.ts` or
`corpus-ref-map.ts` directly — call `searchDocumentation` instead.

## Production-only index

The plugin writes `search-index.json` only from its Webpack `postBuild` hook;
`docusaurus start` never runs a production build, so the file does not exist
in development. `searchDocumentation` mirrors the plugin's own search bar
(`searchByWorker.js` checks `process.env.NODE_ENV === 'production'`) and
returns the explicit `index_dev_unsupported` failure in dev, instead of a
misleading empty result set. A genuinely empty result set (`{ ok: true,
results: [] }`) only ever comes from a production index that legitimately
matched nothing.

## Failure vocabulary

| Code                    | Meaning                                                                           | Retryable |
| ----------------------- | --------------------------------------------------------------------------------- | --------- |
| `index_dev_unsupported` | Not a production build; no index exists.                                          | No        |
| `index_unavailable`     | The index asset request failed (network/HTTP).                                    | Yes       |
| `index_incompatible`    | The fetched index doesn't match this adapter's pinned shape.                      | No        |
| `manifest_unavailable`  | The `#474` corpus manifest request failed, or the corpus plugin isn't registered. | Depends   |
| `manifest_incompatible` | The fetched corpus manifest doesn't match the expected schema.                    | No        |

## Upgrade checklist for `@easyops-cn/docusaurus-search-local`

1. Run `apps/docs`'s tests. A wire-format change surfaces as an
   `index_incompatible` failure from `validateRawSearchIndex` naming the
   group/field that no longer matches — that is this module's pinned
   compatibility fixture/test.
2. Diff `dist/client/client/utils/tokenize.js` (the one function this adapter
   imports) against the new version; update the import if its name or
   signature changed.
3. Confirm `dist/server/server/utils/buildIndex.js`/`scanDocuments.js` still
   emit exactly 5 index groups, in order
   `[title, heading, description, keywords, content]`, with `ref('i')` and
   the same abbreviated field names this file's types encode. A 6th `AskAI`
   group only appears when `searchLocalOptions.askAi` is set; TinyTinkerer
   never sets it.
4. Confirm `hashed`/`searchContextByPaths` handling in `generate.js`/
   `postBuildFactory.js` still matches `SEARCH_INDEX_FILENAME` being a fixed
   `search-index.json` literal (true today because `searchLocalOptions` pins
   `hashed: true`, not `"filename"`, and sets no `searchContextByPaths`) — if
   either config changes, update the URL construction alongside it.

## Why `tokenize` but not `smartQueries`

The plugin's own worker (`worker.js`) builds queries with `smartQueries`, a
typeahead-tuned matcher (incremental-typing wildcards, edit-distance
matrices, a Chinese-word dictionary) that reads its config from a
build-generated virtual module only available inside Docusaurus' own webpack
build. Reusing it would make this adapter depend on that hidden channel and
duplicate UX logic meant for keystroke-by-keystroke search-bar input, not a
single complete assistant query. Instead, this adapter reuses only
`tokenize()` — the pure function that turns a query into the same tokens the
build indexed — and issues its own, simpler lunr query (required presence,
small edit distance on longer tokens, no wildcards — see the comment above
`FUZZY_EDIT_DISTANCE` in private-index-adapter.ts for why wildcards don't mix
well with lunr's stemmer for a complete word) directly against the plugin's
own indexes. This is a deliberate, documented deviation from the plugin's UI
behavior, not a fork of it.
