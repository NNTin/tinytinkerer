# Documentation retrieval (search) adapter

`searchDocumentation` (search-documentation.ts) exposes Docusaurus' local
search — currently the pinned `@easyops-cn/docusaurus-search-local@0.55.2`
plugin — as a small, stable TinyTinkerer retrieval API for assistant tools.
`#471` deliberately uses this local search system rather than a vector
database/RAG service; this module is the compatibility boundary TinyTinkerer
owns around it, so a plugin upgrade can change its private format without any
tool or UI noticing.

## Module boundary

- `private-worker-adapter.ts` is the **only** file that imports
  `@easyops-cn/docusaurus-search-local` internals. It calls the plugin's own
  `searchByWorker()` — the same entry point the site's search bar and
  `/docs/search` page use — validates the response against the pinned contract,
  and returns a small neutral shape (`PrivateIndexSearchHit`) — never the
  plugin's abbreviated document fields (`i`/`t`/`u`/`p`/`h`/`s`/`b`) or its
  `DSLASearchResult` wrapper.
- `corpus-ref-map.ts` maps a hit's page URL to a `#474` corpus ref via the
  documentation corpus's own manifest (`docs-corpus/plugin.ts`,
  `docs-corpus/build-corpus.ts`). It knows nothing about the search plugin.
  The manifest emits every loaded Docusaurus version, so the lookup only
  considers `isLast: true` entries — the pinned search index only ever indexes
  that canonical version's pages. It also cross-checks the fetched manifest's
  own `manifestHash` against the locator's (see "URL normalization" below for
  how the two sides' URLs are kept comparable). Both `searchDocumentation` and
  `loadCorpusRefMap` take a `siteConfig: { baseUrl, trailingSlash }` argument
  (the same shape `useDocusaurusContext().siteConfig` exposes).
- `search-documentation.ts` composes the two into
  `DocumentationSearchResponse`
  (`packages/shared/contracts/src/documentation-search.ts`): it deduplicates
  raw hits down to one result per page (keeping the best matching section),
  drops results that don't map to a listed `#474` document, enforces the
  requested result limit, and builds bounded, safe snippets.

Nothing outside this directory should import `private-worker-adapter.ts` or
`corpus-ref-map.ts` directly — call `searchDocumentation` instead.

> **Landmine for anything built on this (e.g. `#477`).** Docusaurus' Webpack +
> Babel browser targets compile an array-literal spread down to
> `[].concat(x)`, which does the wrong thing for a non-array iterable:
> `[...someMap.values()]` becomes a one-element array holding the _iterator_.
> Vitest transpiles to a modern target and does not reproduce this, so it only
> shows up in a production build. Use `Array.from(...)` for `Map`/`Set`
> iterables in code that ships to the browser.

## Wrapping the worker, not forking it

The plugin's real search entry point is `searchByWorker()`
(`dist/client/client/theme/searchByWorker.js`), which Comlink-wraps a genuine
Web Worker (`theme/worker.js`). `private-worker-adapter.ts` imports that module
with the **byte-identical specifier** the plugin's own `SearchBar.jsx` and
`SearchPage.jsx` use, which has two consequences that matter:

- Webpack resolves both importers to one module instance, so the module-level
  `remoteWorkerPromise` singleton — and the worker's own index cache, keyed on
  `${baseUrl}${searchContext}` — are **shared** with the search bar rather than
  duplicated. Searching from the assistant after searching from the search bar
  re-uses the already-loaded index.
- The import is a **lazy, memoized `import()`**, not a static one, so the worker
  chunk stays out of the entry bundle and no `Worker` is constructed until the
  first query. `#475` requires that: "No search worker or index is loaded merely
  by opening a documentation page or the assistant."

Because the query runs in the worker, everything about _how_ it runs stays
upstream's: tokenization, stop-word handling, the trailing wildcards
`smartQueries` adds for a possibly-incomplete last term, the
`fuzzyMatchingDistance` matrix, `smartTerms`' 12-token cap, its leave-one-out
relaxation at 3+ terms, iteration across the five index groups, the
`?_=<hash>` cache-busting index URL, and the final
`sortSearchResults`/`processTreeStatusOfSearchResults` ordering. This adapter
adds exactly two things upstream does not: runtime validation of the response
contract, and normalization into a stable TinyTinkerer shape.

> **Correction.** An earlier revision of this file claimed `searchByWorker` and
> `worker.js` were "architecturally unreachable" from app code, because
> `worker.js` reads its config from
> `@generated/@easyops-cn/docusaurus-search-local/default/generated-constants.js`.
> That was wrong. Docusaurus' build **does** write that module (see the pinned
> package's `generate.js`; the file lands in
> `apps/docs/.docusaurus/@easyops-cn/docusaurus-search-local/default/`) and the
> `@generated` alias applies to every module in the build, app code included —
> the same channel `corpus-ref-map.ts` already uses for `@generated/globalData`.
> The hand-rolled lunr querying that justification produced reimplemented
> upstream's recall behavior badly, ran on the UI thread, and diverged from the
> site's own `/search` ordering. It has been removed.

## Response validation

`normalizeWorkerResult` in `private-worker-adapter.ts` is `#475`'s "pinned
compatibility fixture" surface, and it is not defensive boilerplate. Upstream's
`SearchWorker.search` builds each result with a bare
`documents.find((doc) => doc.i.toString() === result.ref)` and **no** runtime
check, so a serialized lunr index whose refs have drifted from its own
`documents[]` yields `document: undefined` and a plausible-looking empty result
set. Every result is therefore checked for:

- a `type` inside the five configured groups (`Title`…`Content`); upstream's
  `AskAI = 5` only exists when `searchLocalOptions.askAi` is set, which this
  site never sets;
- a document matching the abbreviated wire record, with `p` required on
  everything but a `Title` record;
- a parent `page` that is literal `false` for a `Title` result and otherwise a
  title-shaped record whose `i` equals the document's `p`;
- a finite `score` and a `tokens` string array.

Anything else becomes `index_incompatible` with a message naming the offending
result and pointing back at the upgrade checklist below.
`__tests__/private-worker-contract.test.ts` runs the **real** upstream
`SearchWorker` over a byte-real serialized index and asserts this is exactly the
shape it produces, so an upgrade that changes it fails with a concrete diff
rather than silently.

## Result ordering

`search-documentation.ts` deliberately does **not** re-rank pages. Raw lunr
scores come from five _independent_ indexes and are not comparable across them,
so sorting by them diverges from what the site's own `/docs/search` page shows
for the same query. Instead:

- **Page order** is the order pages first appear in the worker's already-sorted
  result array.
- **Within a page**, the representative hit prefers one that carries an anchor
  (so a section match cites the section, not the top of the page); among those
  the higher raw lunr score wins, with the worker's own order breaking ties. A
  page-title hit represents the page only when it is all that page produced.

## `section`: human-readable section titles

Each `DocumentationSearchResult` carries `section: string | null` alongside
`anchor: string | null` — `anchor` is a URL slug for navigation
(`read_doc(ref, anchor)`), `section` is the display name of the heading the
match belongs to, for a UI or an assistant to show directly. Derived in
`private-worker-adapter.ts` per the plugin's own `scanDocuments.js` semantics:

```ts
const section = doc.s ?? (doc.h ? doc.t : null)
```

- A Title (whole-page) record has neither `s` nor `h` → `null`.
- A Heading record's own `t` **is** the section title (`s` is never set on
  Heading records).
- A Description/Keywords/Content record's `s` is the enclosing heading's
  title, or the page title itself if the match has no enclosing heading.

## URL normalization

`corpus-ref-map.ts` compares a hit's page URL against a `#474` manifest
permalink after: resolving it to a pathname (so an absolute URL and a bare path
normalize identically, and any query string or fragment is dropped), then
applying `canonicalizeDocusaurusPermalink` — the exact same helper, over
Docusaurus' own `applyTrailingSlash`, that `docs-corpus` built the manifest
with, so the two sides can't drift over trailing-slash policy.

It deliberately does **not** add, strip, or rewrite a base URL or a version
path, because neither is ever needed:

- Both producers already emit base-url-prefixed paths. The plugin's own
  `postBuildFactory.js` asserts `doc.u.startsWith(baseUrl)`, and a Docusaurus
  `permalink` is base-url-aware by construction — with this site's `/docs/`
  base URL, both sides read `/docs/...` already.
- Version paths can't diverge either: the lookup only considers `isLast`
  entries, and the plugin writes exactly one root index covering that same
  canonical version.

## Production-only index

The plugin writes `search-index.json` only from its Webpack `postBuild` hook;
`docusaurus start` never runs a production build, so the file does not exist
in development. `searchDocumentation` mirrors the plugin's own search bar
(`searchByWorker.js` checks `process.env.NODE_ENV === 'production'`) and
returns the explicit `index_dev_unsupported` failure in dev, instead of a
misleading empty result set — upstream itself just returns `[]` there, which
would be indistinguishable from a real zero-result search. A genuinely empty
result set (`{ ok: true, results: [] }`) only ever comes from a production
index that legitimately matched nothing.

## Failure vocabulary

| Code                    | Meaning                                                                           | Retryable |
| ----------------------- | --------------------------------------------------------------------------------- | --------- |
| `index_dev_unsupported` | Not a production build; no index exists.                                          | No        |
| `index_unavailable`     | The worker could not load or query the index (network/HTTP).                      | No¹       |
| `index_incompatible`    | The worker's response doesn't match this adapter's pinned contract.               | No        |
| `manifest_unavailable`  | The `#474` corpus manifest request failed, or the corpus plugin isn't registered. | Depends²  |
| `manifest_incompatible` | The corpus locator or manifest doesn't match the expected schema.                 | No        |

¹ Not retryable **in the current page session**, which is what `retryable`
means to a caller. Upstream's `SearchWorker.lowLevelFetchIndexes` memoizes its
index fetch in a module-level `Map` and stores the promise _before_ awaiting it,
so a rejected fetch is replayed to every later caller. That cache lives inside
the worker and cannot be evicted from here, so the message tells the user to
reload the page rather than inviting a futile retry loop. If in-session recovery
ever becomes necessary, fix or fork the upstream cache explicitly — do not
instantiate a second worker, which would duplicate the index in memory and
defeat the singleton reuse described above.

² Retryable for a network/HTTP failure, not for a missing corpus plugin. This
cache is TinyTinkerer's own, so `corpus-ref-map.ts` evicts a retryable failure
immediately and the next call gets a fresh attempt. Its cache is keyed by
manifest URL, manifest hash, base URL and trailing-slash policy, so one
caller's site config can never decide another's normalization.

## Upgrade checklist for `@easyops-cn/docusaurus-search-local`

0. The `private-worker-adapter.test.ts` "pinned version" test fails immediately
   (asserting `apps/docs/package.json` still declares `0.55.2`, matching
   `PINNED_SEARCH_PLUGIN_VERSION`) as a tripwire pointing back at this checklist
   — it's not a substitute for actually working through the rest of it. It reads
   _our_ manifest rather than the plugin's, so this directory's "only the
   compatibility module imports package internals" rule stays mechanically true.
1. Run `apps/docs`'s tests. `private-worker-contract.test.ts` drives the real
   upstream `SearchWorker` and is where a changed response contract surfaces
   first, naming the field that no longer matches.
2. Diff `dist/client/client/theme/searchByWorker.js` and `theme/worker.js`: the
   `searchByWorker(baseUrl, searchContext, input, limit)` signature, the
   `NODE_ENV === 'production'` gate, the module-level worker singleton, and the
   result fields (`document`, `type`, `page`, `metadata`, `tokens`, `score`)
   this adapter validates. Also re-diff `dist/client/shared/interfaces.js` for
   the `SearchDocumentType` ordinals, and `dist/server/server/utils/scanDocuments.js`
   if `section`'s derivation (documented above) stops matching real behavior.
3. Confirm `dist/server/server/utils/buildIndex.js`/`scanDocuments.js` still
   emit exactly 5 index groups, in order
   `[title, heading, description, keywords, content]`, with `ref('i')` and the
   same abbreviated field names. A 6th `AskAI` group only appears when
   `searchLocalOptions.askAi` is set; TinyTinkerer never sets it, and the
   adapter rejects a `type` outside `0..4`.
4. Confirm `generate.js` still emits the constants
   `apps/docs/src/test/generated-search-constants-stub.ts` mirrors
   (`language`, `removeDefaultStopWordFilter`, `searchIndexUrl`,
   `searchResultLimits`, `fuzzyMatchingDistance`) — if the worker starts
   reading a new one, add it to the stub or the contract test quietly stops
   exercising real behavior. Also confirm `searchContextByPaths` is still
   unset for this site, since `private-worker-adapter.ts` passes an empty
   search context on that basis.
