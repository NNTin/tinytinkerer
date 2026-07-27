# Documentation retrieval (search) adapter

`searchDocumentation` (search-documentation.ts) exposes Docusaurus' local
search — currently the pinned `@easyops-cn/docusaurus-search-local@0.55.2`
plugin — as a small, stable TinyTinkerer retrieval API for assistant tools.
`#471` deliberately uses this local search system rather than a vector
database/RAG service; this module is the compatibility boundary TinyTinkerer
owns around it, so a plugin upgrade can change its private format without any
tool or UI noticing.

## Module boundary

- `private-worker-adapter.ts` is the only **production** module that imports
  `@easyops-cn/docusaurus-search-local` internals. It drives the plugin's own
  `fetchIndexesByWorker()`/`searchByWorker()` — the same entry points the site's
  search bar and `/docs/search` page use — validates the response against the
  pinned contract, and returns a small neutral shape (`PrivateIndexSearchHit`) —
  never the plugin's abbreviated document fields (`i`/`t`/`u`/`p`/`h`/`s`/`b`),
  its `DSLASearchResult` wrapper, or its lunr match metadata. Two non-production
  files deliberately reach one module further: `easyops-search-worker.d.ts`
  declares `theme/worker.js`, and `__tests__/private-worker-contract.test.ts`
  imports it to drive the genuine upstream `SearchWorker` without a real
  `Worker`.
- `corpus-ref-map.ts` maps a hit's page URL to a `#474` corpus ref. It knows
  nothing about the search plugin — and nothing about fetching either: it is a
  thin canonical-version projection over
  **`docs-corpus/manifest-store.ts`**, the shared runtime store that owns
  locator discovery, full-contract validation, integrity verification, caching
  and retry for _every_ documentation consumer. `#477`'s `read_doc` reaches the
  same store for the same entries' `artifact` when a search result's `ref` is
  handed straight to it, so search and reads cannot develop separate ideas of
  what the corpus is. `searchDocumentation` takes a
  `siteConfig: { baseUrl, trailingSlash }` argument (the same shape
  `useDocusaurusContext().siteConfig` exposes) and passes it through.
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
Web Worker (`theme/worker.js`). `private-worker-adapter.ts` imports **that same
module**. Upstream's own theme components spell the specifier `../searchByWorker`
— relative and extensionless, which nothing outside the package can write — but
both spellings resolve to the same file, which has two consequences that matter:

- Webpack serves both importers from one module instance, so the module-level
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
- a document matching the **per-type** field shape `scanDocuments.js` emits, not
  just a generic record — a Title always has `b` and never `p`/`s`/`h`, a
  Heading has `p` and an optional `h` but never `s`, Description/Keywords always
  have `s` and never `h`, Content has both. `section`'s derivation below depends
  on exactly this, so a type that starts or stops carrying one of these must not
  pass. `b` is **required** on Title records (and on every parent `page`, which
  is one): `parseDocument.js` and `parsePage.js` both initialise `breadcrumb` to
  `[]` and always return it, so its absence is drift rather than an upstream
  variation — an empty array is normal and accepted;
- integer document ids;
- a parent `page` that is literal `false` for a `Title` result and otherwise a
  title-shaped record whose `i` equals the document's `p` **and whose `u`
  matches the document's** — a child attached to one page while carrying another
  page's URL would otherwise be cited against the wrong corpus ref;
- a finite `score` and a `tokens` string array;
- match metadata carrying at least one `[start, length]` position, with integer
  offsets that actually fall inside the indexed text (see "Snippets" below).

Anything else becomes `index_incompatible` with a message naming the offending
result and pointing back at the upgrade checklist below.
`__tests__/private-worker-contract.test.ts` runs the **real** upstream
`SearchWorker` over a byte-real serialized index and asserts this is exactly the
shape it produces, so an upgrade that changes it fails with a concrete diff
rather than silently.

## Result ordering

`search-documentation.ts` deliberately does **not** re-rank anything. Raw lunr
scores come from five _independent_ indexes and are not comparable across them,
so sorting by them diverges from what the site's own `/docs/search` page shows
for the same query. Instead:

- **Page order** is the order pages first appear in the worker's already-sorted
  result array.
- **Within a page**, the representative is that page's **first** hit — the one
  the worker itself ranked highest for that page, whose anchor and section
  therefore describe why the page matched.

An earlier revision preferred any anchored hit over an unanchored one, on the
theory that a section citation is always more useful. That was wrong in
practice: for `how can I host TinyTinkerer` it replaced the Vercel deployment
guide's page-intro match with a later, weaker relaxed match on "1.1 Create the
OAuth App", and for an exact page-title query it cited "Next step" instead of
the page. Since #477 hands these to a model as grounding and to users as
clickable citations, manufacturing section specificity the match doesn't support
is worse than citing the page.

### Stability under `maxResults`

`results(N)` is a **prefix** of `results(M > N)`: asking for more results extends
the list rather than reordering it. That is a property the public facade has to
provide, not one it inherits — **the pinned worker is not monotonic in its own
`limit`.** It fills the requested limit while iterating smart-query tiers and
index groups, breaks as soon as it is full, and only _then_ sorts. So a larger
limit can admit a page's title during a later relaxed tier, and because
`sortSearchResults` keys a section hit on the index of its page's title, that
page's already-admitted section hit gets dragged down beside it. A bigger run is
neither a stable prefix nor a set superset.

An earlier revision derived the first raw limit from `maxResults`, which handed
that instability straight to callers: on the production index,
`searchDocumentation(…, 'app', 6)` and `(…, 'app', 20)` disagreed about the top
citations. Two rules fix it by construction:

- every search starts from the same fixed window (`INITIAL_RAW_HITS`),
  independent of `maxResults`;
- expansion is **append-only** — a larger pass contributes only pages not
  already seen, and never replaces an existing page's representative.

Expansion is still needed because the number of raw hits one page produces is
unbounded (one document per heading _and_ per content section, so a large page
can occupy dozens of consecutive slots). `fetchMappedPages` doubles the limit
until enough distinct eligible pages have accumulated, the worker returns fewer
hits than it was asked for, or a documented ceiling is reached.
`private-worker-contract.test.ts` pins the underlying non-monotonicity against
the real worker, so the reason for this design cannot quietly stop being true.

## Snippets

The plugin indexes a whole section as one document, and real sections run to
several thousand characters. Truncating from the start therefore routinely
produced a snippet containing none of the query terms — a citation with no
evidence for why it matched. (Real case: `abort/reset` matches a Plugin
Infrastructure section at character 4,949 of 7,446.)

So `private-worker-adapter.ts` normalizes lunr's match metadata into
`PrivateIndexMatchRange[]` — a TinyTinkerer-owned `{ start, length }` shape,
ordered exactly the way the plugin's own `getStemmedPositions` orders it — and
`boundedSnippet` centers a bounded window on the first match, with `…` marking
either elision. Whitespace is collapsed only _after_ slicing, since the offsets
index the raw text.

**At least one valid position is required.** For this pinned version that is
provable, not a judgement call: `buildIndex.js` indexes exactly one field (`t`)
and sets `metadataWhitelist = ["position"]`, so a positive lunr result
necessarily matched that field and necessarily records its offsets, and the
worker forwards match metadata unchanged. Verified across 1,590 real worker
results (document types 0/1/2/4) on the production index — none lacked them.
Tolerating the absence would silently reintroduce the leading-snippet defect this
section exists to fix, so it is `index_incompatible` instead. The contract test
asserts this **per result**, not in aggregate, so one document type cannot stop
carrying offsets while the suite stays green.

## `section`: human-readable section titles

Each `DocumentationSearchResult` carries `section: string | null` alongside
`anchor: string | null` — `anchor` is a URL slug for navigation
(`read_doc(ref, anchor)`), `section` is the display name of the heading the
match belongs to, for a UI or an assistant to show directly. Derived in
`private-worker-adapter.ts` per the plugin's own `scanDocuments.js` semantics:

It is derived from the document **type**, not from which optional fields happen
to be populated:

- Title (whole page) → `null`.
- Heading → the record's own `t`; a heading's text **is** its section title.
- Description/Keywords/Content → `s`, the enclosing heading's title, or the page
  title itself if the match has no enclosing heading.

Keying off field presence instead (`doc.s ?? (doc.h ? doc.t : null)`) looked
equivalent and was not: the production index carries `h: ""` for four headings
under `/docs/contributing/`, where Docusaurus renders no anchor. Those results
correctly reported `anchor: null` but wrongly reported `section: null` — a
heading has a name whether or not navigation can target it.

## URL normalization

The corpus store compares a hit's page URL against a `#474` manifest
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
| `index_unavailable`     | The worker chunk or the index itself could not be loaded.                         | Depends¹  |
| `index_incompatible`    | The worker's response, or the query it ran, doesn't match the pinned contract.    | No        |
| `manifest_unavailable`  | The `#474` corpus manifest request failed, or the corpus plugin isn't registered. | Depends²  |
| `manifest_incompatible` | The corpus locator or manifest doesn't match the expected schema.                 | No        |

¹ `retryable` means "the caller can retry this in the current page session", so
the three things that can go wrong here are driven — and reported — separately
rather than through one catch-all:

- **The worker chunk fails to download.** Retryable: that memo is ours, and
  `loadSearchByWorker` drops a rejected import so the next call re-fetches.
- **Index initialization fails** (`fetchIndexesByWorker`). Not retryable, and
  the message asks for a reload. Upstream's `SearchWorker.lowLevelFetchIndexes`
  stores its fetch promise in a module-level `Map` _before_ awaiting it, so a
  rejected fetch is replayed to every later caller; that cache lives inside the
  worker and cannot be evicted from here.
- **The query itself throws after the index loaded** (`searchByWorker`). This is
  `index_incompatible`, not `index_unavailable`: the index _is_ available, the
  worker's own tokenize/query/sort path is what failed, and a reload would not
  help — so claiming one would be misleading. Driving initialization separately
  is what makes this distinction possible at all.

If in-session recovery from a failed index load ever becomes necessary, fix or
fork the upstream cache explicitly — do not instantiate a second worker, which
would duplicate the index in memory and defeat the singleton reuse described
above.

² Retryable for a network/HTTP failure, not for a missing corpus plugin. This
cache is TinyTinkerer's own, so `docs-corpus/manifest-store.ts` evicts a
retryable failure immediately and the next call gets a fresh attempt. Its cache
is keyed by manifest URL, manifest hash, base URL and trailing-slash policy, so
one caller's site config can never decide another's normalization.
`manifest_incompatible` additionally covers a manifest that fails **integrity
verification** — the store recomputes the SHA-256 `build-corpus.ts` advertises,
rather than trusting two self-reported strings to agree, since a payload edited
under a content-addressed URL would otherwise be accepted.

## Upgrade checklist for `@easyops-cn/docusaurus-search-local`

0. The `private-worker-adapter.test.ts` "pinned version" test fails immediately
   (asserting `apps/docs/package.json` still declares `0.55.2`, matching
   `PINNED_SEARCH_PLUGIN_VERSION`) as a tripwire pointing back at this checklist
   — it's not a substitute for actually working through the rest of it. It reads
   _our_ manifest rather than the plugin's, so the "only the compatibility
   module imports package internals" rule stays mechanically true for production
   code.
1. Run `apps/docs`'s tests. `private-worker-contract.test.ts` drives the real
   upstream `SearchWorker` and is where a changed response contract surfaces
   first, naming the field that no longer matches.
2. Diff `dist/client/client/theme/searchByWorker.js` and `theme/worker.js`: the
   `searchByWorker(baseUrl, searchContext, input, limit)` and
   `fetchIndexesByWorker(baseUrl, searchContext)` signatures, the
   `NODE_ENV === 'production'` gate, the module-level worker singleton, whether
   `lowLevelFetchIndexes` still memoizes rejections (the failure table above
   depends on it), and the result fields (`document`, `type`, `page`,
   `metadata`, `tokens`, `score`) this adapter validates. Also re-diff
   `dist/client/shared/interfaces.js` for the `SearchDocumentType` ordinals,
   `dist/client/client/utils/getStemmedPositions.js` for the
   `metadata[term].t.position` layout snippets depend on, and
   `dist/server/server/utils/scanDocuments.js` for the per-type field shape the
   validator and `section`'s derivation both encode. Also re-check
   `sortSearchResults.js` and the `results.length >= limit` break in
   `worker.js`: the limit non-monotonicity documented above is what
   `fetchMappedPages`' fixed-window, append-only shape exists to absorb.
3. Confirm `dist/server/server/utils/buildIndex.js`/`scanDocuments.js` still
   emit exactly 5 index groups, in order
   `[title, heading, description, keywords, content]`, with `ref('i')` and the
   same abbreviated field names, one indexed field (`t`) and
   `metadataWhitelist = ['position']`. A 6th `AskAI` group only appears when
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
