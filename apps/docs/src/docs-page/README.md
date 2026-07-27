# Active documentation page context

`DocsPageProvider` is the documentation assistant's bridge between Docusaurus
routing and "which authored document am I on?" (issue #476). It is mounted once
from the swizzled `@theme/Root` (`src/theme/Root.tsx`), which Docusaurus keeps
mounted above the layout and outside the route tree for the whole lifetime of
the SPA — so the provider survives every client-side navigation.

Consumers read it with `useDocsPageContext()`:

```tsx
const { pathname, active } = useDocsPageContext()
if (active.status === 'document') {
  // active.document: { ref, version, isLast, title, permalink, unlisted }
} else {
  // active.reason: why this route has no current document
}
```

## What "current page" means

Narrowly: an **authored** Docusaurus documentation document that exists in the
#474 corpus. The docs landing route, `/search`, generated category index pages,
and 404s may all still show the global assistant, but none of them has a current
document, and each says so explicitly rather than returning `undefined`:

| `reason`                  | route                                                     |
| ------------------------- | --------------------------------------------------------- |
| `not_a_document_route`    | `/search`, 404s, anything Docusaurus routes to no doc     |
| `generated_index_route`   | a Docusaurus-generated category index                     |
| `corpus_pending`          | static render / first hydration render, manifest not read |
| `corpus_unavailable`      | the corpus manifest failed to load or validate            |
| `unknown_active_document` | an authored-looking active id absent from the corpus      |

Only `corpus_pending` and a retryable `corpus_unavailable` are worth trying
again; the state carries `retryable` so a caller does not have to know which is
which. Authored **unlisted** documents are current documents on a direct visit —
#475 keeps them out of global search, which is not the same as unreadable once a
reader is standing on the page.

## How identity is resolved

1. Docusaurus' own `useActiveDocContext` supplies the active document id and
   version for the current route. No pathname heuristics, and nothing is read
   from the DOM — not headings, prose, metadata, or ids.
2. The id is resolved through the shared #474 corpus store
   (`docs-corpus/manifest-store.ts`) by `(version, ref)`. Resolving by id rather
   than by URL is what makes base URLs, trailing-slash policy, versioned paths,
   and deep links irrelevant to the _answer_: no spelling of the route can change
   which document it is.
3. Everything exposed about the document — title, canonical permalink,
   `unlisted` — comes from that manifest entry, so a citation here is the same
   canonical URL a #475 search result carries and the same `ref` #477's
   `read_doc` accepts.

Docusaurus puts generated category indices in the same `version.docs` list as
authored documents and gives them their slug as an id. Its own `GlobalDoc` type
records the tell: slugs have leading slashes, ids do not. That distinction is
what keeps a healthy site's category pages from looking like corpus drift.

## Diagnostics

Route/manifest mapping anomalies are reported to the console once per distinct
anomaly, and never change what is resolved:

- `unknown_active_document` — Docusaurus considers an authored-looking id active
  that the corpus manifest has no entry for.
- `permalink_mismatch` — the manifest records the active document at a different
  canonical permalink than the route normalizes to. Docusaurus remains the
  authority on which id is active, so the document still resolves; the corpus and
  the built routes disagreeing is the thing worth shouting about.

The route's own spelling is normalized with the very same
`canonicalizeDocusaurusPermalink` helper that `build-corpus.ts` produced the
manifest's permalinks with, so trailing-slash policy can never masquerade as
drift.

## Atomicity, static rendering, and hydration

`pathname` and the resolved identity are both derived during the same render,
from the same `useLocation()` the router updates. No effect copies the route into
state afterwards, so there is no window in which a consumer could observe the
previous document id beside the new pathname. Only the corpus store itself is
asynchronous state, and it is route-independent.

Because the identity follows the _router_, it leads the painted page during
Docusaurus' `PendingNavigation` chunk-preload window: the context reports the
destination document while the browser still shows the previous one for a few
milliseconds. That is the intended reading of "current page" — the page being
navigated to — and it is the only definition available without inspecting
rendered output, which #476 forbids.

The corpus load happens in an effect, so static rendering never runs it: a
static render and the first hydration render both produce `corpus_pending`, and
therefore agree. Nothing in this directory touches `window` or `document`;
`__tests__/static-rendering.test.tsx` proves it by rendering the real
`@theme/Root` with `renderToString` in a **node** environment where neither
exists, and pins the source-level rule beside it.
