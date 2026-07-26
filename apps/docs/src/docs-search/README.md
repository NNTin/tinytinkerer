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
  the plugin's raw `search-index.json`, runs a tiered, progressively-relaxed
  query against the loaded lunr indexes (see "Progressive query relaxation"
  below), and returns a small neutral shape (`PrivateIndexSearchHit`) — never
  the plugin's abbreviated document fields (`i`/`t`/`u`/`p`/`h`/`s`/`b`).
- `corpus-ref-map.ts` maps a hit's page URL to a `#474` corpus ref via the
  documentation corpus's own manifest (`docs-corpus/plugin.ts`,
  `docs-corpus/build-corpus.ts`). It knows nothing about the search plugin.
  The manifest emits every loaded Docusaurus version, so the lookup only
  considers `isLast: true` entries — the pinned search index only ever
  indexes that canonical version's pages. It also cross-checks the fetched
  manifest's own `manifestHash` against the locator's, and normalizes both a
  hit's raw URL and a manifest permalink through the exact same
  `canonicalizeDocusaurusPermalink` helper `docs-corpus` built the manifest
  with (`docusaurus-compatibility.ts`), so the two can't drift apart over
  absolute-vs-relative URLs, query strings/fragments, or trailing slashes.
  Both `searchDocumentation` and `loadCorpusRefMap` take a `siteConfig:
{ baseUrl, trailingSlash }` argument (the same shape
  `useDocusaurusContext().siteConfig` exposes) for this normalization.
- `search-documentation.ts` composes the two into
  `DocumentationSearchResponse`
  (`packages/shared/contracts/src/documentation-search.ts`): it deduplicates
  raw hits down to one result per page (keeping the best-scoring section),
  drops results that don't map to a listed `#474` document, enforces the
  requested result limit, and builds bounded, safe snippets.

Nothing outside this directory should import `private-index-adapter.ts` or
`corpus-ref-map.ts` directly — call `searchDocumentation` instead.

Every cache in this directory (the loaded search index, the corpus ref map)
only memoizes a _stable_ outcome — success, or a non-retryable failure like
`index_incompatible`. A retryable failure (`index_unavailable`,
`manifest_unavailable` from a network/HTTP error) is evicted immediately, so
the next call gets a fresh attempt instead of replaying the same failure
until a full page reload.

## `section`: human-readable section titles

Each `DocumentationSearchResult` carries `section: string | null` alongside
`anchor: string | null` — `anchor` is a URL slug for navigation
(`read_doc(ref, anchor)`), `section` is the display name of the heading the
match belongs to, for a UI or an assistant to show directly. Derived in
`private-index-adapter.ts` per the plugin's own `scanDocuments.js` semantics:

```ts
const section = doc.s ?? (doc.h ? doc.t : null)
```

- A Title (whole-page) record has neither `s` nor `h` → `null`.
- A Heading record's own `t` **is** the section title (`s` is never set on
  Heading records).
- A Description/Keywords/Content record's `s` is the enclosing heading's
  title, or the page title itself if the match has no enclosing heading.

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

0. The `private-index-adapter.test.ts` "pinned version" test fails
   immediately (asserting the installed version is still `0.55.2`) as a
   tripwire pointing back at this checklist — it's not a substitute for
   actually working through the rest of it.
1. Run `apps/docs`'s tests. A wire-format change surfaces as an
   `index_incompatible` failure from `validateRawSearchIndex` naming the
   group/field that no longer matches — that is this module's pinned
   compatibility fixture/test.
2. Diff `dist/client/client/utils/tokenize.js` (the one function this adapter
   imports) against the new version; update the import if its name or
   signature changed. Also re-diff `dist/client/client/utils/smartQueries.js`
   and `dist/server/server/utils/scanDocuments.js` if the query-relaxation
   tiers or `section`'s derivation (both documented above) ever stop matching
   real search-bar behavior — re-verify against a real production build the
   same way this feature's fix was validated (a small, uncommitted script
   loading `search-index.json` through `searchPrivateIndex` directly).
3. Confirm `dist/server/server/utils/buildIndex.js`/`scanDocuments.js` still
   emit exactly 5 index groups, in order
   `[title, heading, description, keywords, content]`, with `ref('i')` and
   the same abbreviated field names this file's types encode
   (`validateRawSearchIndex` now rejects anything other than exactly 5). A
   6th `AskAI` group only appears when `searchLocalOptions.askAi` is set;
   TinyTinkerer never sets it.
4. Confirm `hashed`/`searchContextByPaths` handling in `generate.js`/
   `postBuildFactory.js` still matches `SEARCH_INDEX_FILENAME` being a fixed
   `search-index.json` literal (true today because `searchLocalOptions` pins
   `hashed: true`, not `"filename"`, and sets no `searchContextByPaths`) — if
   either config changes, update the URL construction alongside it.

## Why `tokenize`, but neither `smartQueries` nor `searchByWorker`

The plugin's real search entry points, `searchByWorker`/`fetchIndexesByWorker`
(`dist/client/client/theme/searchByWorker.js`), are Comlink-wrapped calls into
an actual Web Worker (`worker.js`, `Comlink.expose(SearchWorker)`) — not
plain functions. Both are also hard-gated on `NODE_ENV === 'production'`, and
the worker's query builder, `smartQueries.js`, reads its `language`,
`removeDefaultStopWordFilter`, and `fuzzyMatchingDistance` config from
`./proxiedGeneratedConstants`, which re-exports a Docusaurus-webpack-generated
virtual module (`@generated/@easyops-cn/docusaurus-search-local/default/
generated-constants.js`) materialized only inside the site's own build — not
passable as a plain argument. Calling either directly from this adapter is
not a style choice this module opted out of; it is architecturally
unreachable outside a live browser build's own worker thread.

Instead, this adapter reuses only `tokenize()` — the pure function that
turns a query into the same tokens the build indexed — and reimplements the
_mechanism_ `smartQueries` uses for recall (progressive relaxation), scoped
to what a complete assistant query needs rather than the incremental-typing
wildcard/edit-distance machinery real keystroke-by-keystroke search-bar input
needs.

### Progressive query relaxation

An earlier version of this adapter marked every tokenized query term
`presence: REQUIRED` in a single query per index group. Against a real
production build, complete natural-language questions like `"how can I host
TinyTinkerer"` or `"where can I find plugin infrastructure"` — exactly the
kind of query issue #471 exists to support — returned **zero** hits, while
the plugin's own search bar found dozens. Tracing `smartQueries.js` end to
end explains why, and it's not what it looks like at first: lunr's default
English `stopWordFilter` is active for this site (`searchLocalOptions` never
sets `removeDefaultStopWordFilter`), and lunr runs that same pipeline on a
_query_ term before matching it — so a stopword submitted as a `REQUIRED`
term is **already a no-op**, not a hard requirement, in both the old code and
the real plugin. The actual reason `smartQueries` finds more is that it
builds and tries several separate all-`REQUIRED` queries over different
_subsets_ of the remaining content words — specifically, "leave-one-out"
variants that each drop exactly one word — so a page whose matching words
never all co-occur in one indexed field can still be found via a variant
that doesn't require the missing one.

`private-index-adapter.ts` reimplements this as three ordered tiers, tried
only as needed (an escalation to a looser tier only happens if the current
one hasn't found enough distinct results for the caller's requested `limit`
after scanning **every** index group — see the note on the early-break fix
below):

1. **`exact`** — every token `REQUIRED` (the original, unchanged behavior).
   Any query this alone satisfies is completely unaffected by the tiers
   below.
2. **`stopword_trimmed`** — drop tokens `lunr.stopWordFilter` identifies as
   stopwords (checked directly via `lunr.stopWordFilter(new
lunr.Token(word, {}))`, not a hand-rolled list), if that's non-empty and
   shorter than the original. Provably redundant under this site's current
   config for the reason above — kept for defense-in-depth if
   `removeDefaultStopWordFilter` is ever configured later.
3. **`leave_one_out`** — for the (possibly trimmed) remaining tokens, once
   there are **2 or more**, one variant per token that drops exactly that
   token, each still all-`REQUIRED`.

Hits are merged and ranked across tiers _and_ across all 5 index groups by a
large fixed per-tier score offset (`TIER_SCORE_OFFSET`) added to lunr's own
score, so an `exact` hit always outranks a `leave_one_out` hit regardless of
raw lunr score, and `search-documentation.ts`'s existing score-based re-sort
automatically respects this with no changes of its own.

**Deliberate deviation from upstream's own threshold**: the real plugin only
generates leave-one-out variants once 3+ content words remain (`term.length >
2`); this adapter lowers that to 2, so a two-content-word question (e.g.
`"host TinyTinkerer"`) falls back to matching either word alone as a
last-resort tier if the two never co-occur. This is a real precision/recall
trade-off, not a mechanical port — accepted here because #471 explicitly
prioritizes answering natural-language questions over upstream's more
conservative default. See `LEAVE_ONE_OUT_MIN_TOKENS` in
`private-index-adapter.ts`.

**The early-break fix**: every index group is now scanned in full for a tier
before deciding whether to escalate. The previous code stopped as soon as
`limit` raw hits accumulated mid-scan, which could both bias the escalation
decision toward whichever group happened to be queried first and miss a
later group's better section for a page already seen via an earlier group.

**Known, accepted gap**: the plugin's own `?_=<hash>` cache-busting query
string on `search-index.json` can't be reproduced here for the same
virtual-module reason described above — this adapter always fetches the
stable, un-suffixed filename. This only affects browser HTTP cache
aggressiveness immediately after a fresh deploy, never search correctness.
