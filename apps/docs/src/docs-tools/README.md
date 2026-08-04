# Documentation tools

The three tools the documentation assistant answers with (issue #477):
`search_docs`, `read_doc`, and `read_current_doc`. They compose the three
pieces that landed before them and add nothing to the corpus itself:

| Comes from                                        | Used for                                            |
| ------------------------------------------------- | --------------------------------------------------- |
| `docs-corpus/manifest-store.ts` (#474)            | which document a `ref` is, and where its body lives |
| `docs-corpus/artifact-store.ts` (#474, lazy half) | the body: Markdown, outline, section boundaries     |
| `docs-search/search-documentation.ts` (#475)      | which documents match a query                       |
| `docs-page/page-snapshot.ts` (#476)               | which document the reader is on                     |

Nothing here reads the DOM, and nothing here fetches a URL. Both are checked
mechanically by `__tests__/source-rules.test.ts` rather than left to review,
because they are properties of the code rather than of any one code path.

## The group, not a plugin

`createDocumentationToolGroup()` returns an `AppToolGroup`
(`{ id: 'documentation', label: 'Documentation', tools }`) — the same mechanism
`apps/canvas` and `apps/mermaid` use for their stage verbs. `apps/docs` still
cannot name a concrete `@tinytinkerer/plugin-*` package — `scripts/check-boundaries.mjs`
allows that only inside `@tinytinkerer/catalogue` — but since issue #495 it is a
plugin host: each documentation app injects its own catalogue. An app group is
still the right shape for these three — the documentation tools are intrinsic to
the documentation assistant, so there is nothing for an activation toggle to
mean. Individual
tools remain independently switchable through the ordinary tool picker's
per-tool disablement.

**#479 mounts them.** This issue ships the group and its contracts; the
assistant `BrowserApp` that passes it to `createBrowserApp(config, { appToolGroup })`
is #479's, and that is where live tool-picker visibility is asserted. Host
rendering of an app group — the checkbox tree, per-tool disablement, the `none`
tri-state — is already covered generically by
`packages/app/app-browser/tests/tool-tree.test.tsx`, which cannot import an app.
What `__tests__/tools.test.ts` pins is the half that lives here: that the group
satisfies everything `useToolTree` and `ToolRegistry` require of it.

`siteConfig` is injected rather than read, because a `Tool` is a plain object
whose `execute` runs outside React. It defaults to whatever #476 last published.

## Output contracts

`schemas.ts` owns both directions. `schema` is what `ToolRegistry.run` parses the
model's arguments with — and what the planner-visible JSON Schema is generated
from, so the model can never be shown a shape the tool does not accept.
`outputSchema` is an **enforcement point**: the registry throws on a result that
fails it. Every object is `.strict()`.

Discriminants are spelled `status`, per the locked issue text, rather than the
`ok: boolean` of the #474/#475 wire contracts these compose. A model branches
better on a named string, and the tool boundary is where the two vocabularies
meet.

Owner decisions that shaped these contracts are recorded on the issue
(https://github.com/NNTin/tinytinkerer/issues/477). In summary:

- **`read_current_doc` has two no-document statuses.** `not_on_doc_page` for a
  route that genuinely has none (`/search`, a 404, a generated index) and
  `unavailable` for identity that could not be established (`corpus_pending`,
  `corpus_unavailable`, `corpus_incompatible`, `unknown_active_document`).
  Reporting "this is not a documentation page" when retrieval is broken is both
  false and unactionable.
- **Reads carry `truncation` beside `truncated`.** `docs-corpus/README.md`
  requires a bounded reader to return `DocumentationCorpusReadTruncation`;
  `nextSectionAnchor` is what turns "there is more" into a follow-up call the
  model can actually make.
- **`doc` carries `version` and `isLast`.** Artifacts are per-version. Without
  them, `read_current_doc` on a historical route would return a `ref` that
  `read_doc(ref)` resolves to the canonical version — different content, with
  nothing in the response to reveal it. `read_doc`'s input stays canonical-only;
  this site loads no versioned docs, and a `version` parameter is not in the
  locked schema.
- **One corpus-failure vocabulary.** `DocumentationCorpusLoadFailureCode`'s
  `manifest_invalid` was renamed to `manifest_incompatible` to match the store.
  #477 was its first consumer, so the rename was free.
- **`search_docs` forwards #475's failure code verbatim** under one
  `search_unavailable` status, the same shape `docs-search/corpus-ref-map.ts`
  already forwards a store code with. A zero-result search is `ok`, never a
  failure. Under `docusaurus start` the normal answer is
  `index_dev_unsupported`, because the upstream plugin only writes its index
  during a production build.
- **`maxChars` is clamped, not rejected.** "No response exceeds the enforced
  output limit, even if a caller supplies a larger `maxChars`" describes
  bounding, not an error.

## Corpus recovery, and what "awaited" means

`read_current_doc` calls #476's `retryCorpus()` when it sees a retryable corpus
failure, and **waits for the retry it started** before answering.

Triggering recovery is not enough, and the difference is subtle enough to have
been wrong once. The provider's `retryCorpus` calls `setCorpus`, so the _current_
snapshot immediately afterwards is still the failure that prompted the retry —
a wait keyed on "is the state settled?" is satisfied by that failure and returns
it. Nor can the values discriminate: a retry that also fails republishes an
equal-looking failure.

So every published snapshot carries a monotonically increasing `revision`, and
the wait is for a snapshot **newer than the one that triggered the retry** which
is also no longer pending — skipping the interim `corpus_pending` the provider
publishes on its way to the outcome.

`corpus_pending` is deliberately _not_ retried even though #476 marks it
retryable: the provider's gate makes `retryCorpus` a no-op while a load is in
flight, so calling it would spend the deadline for nothing.

**One deadline, not one per wait.** First-publication, corpus-settling, and
retry waits share a single absolute budget of 4s. Independent timeouts compose
badly — 1s + 4s + 4s would have consumed almost all of the runtime's 10s machine
tool timeout before the artifact fetch could start.

## Route pinning

A call is **pinned to the route it was made on**. Every wait requires the
snapshot to still be for that pathname, so a reader who asks about "this page"
and then navigates gets an answer about the page they asked about.

This is a policy choice rather than a fallout of the implementation, recorded
here because #479 and #480 would otherwise inherit it by accident: following the
latest route would mean answering about a page the reader never asked about,
using a question they asked somewhere else.

## Bounding a response

The ceiling is not a number this issue invents. `clampChatMessageContent` drops
the tail of any outgoing chat message longer than
`MAX_CHAT_MESSAGE_CONTENT_CHARS`, tool results included. A response that overran
it would be cut by the _transport_, severing the outline and truncation metadata
from the Markdown they describe — precisely the silent truncation #474's
bounded-read contract exists to prevent.

So `response-cap.ts` fits every payload below that limit, measured on
`JSON.stringify(payload).length` rather than on Markdown length. On this site's
real documents the Markdown → JSON ratio is **1.13–1.20** (19,588 characters of
Markdown serialize to 23,456), and heavier escaping pushes it higher: a character
count of the Markdown alone is not a safe proxy for what goes on the wire. The
constant is re-exported through
`@tinytinkerer/app-browser/documentation-corpus` — not the app-browser barrel,
which reaches `virtual:pwa-register` and cannot load outside a Vite app build.

**Failures are bounded too, and that is where the limit actually bit.** Fitting
only successful reads left the typed-failure contract defeating itself: `ref` and
`anchor` had no upper bound, and a 40,000-character `ref` produced a
`document_not_found` serializing to about **80,000 characters** — which the
transport would cut mid-JSON, handing the model an unparseable fragment instead
of an actionable error. Three things fix it, in order of how much they matter:

1. `ref`, `anchor` and `pathname` are bounded (300 characters for the first two,
   which the input contracts enforce — this site's longest real ref is 39 and
   its longest anchor 71; 1,000 for a route, which no schema can bound because
   it comes from the SPA rather than from the model);
2. every free-form message — including upstream text this code did not author —
   is bounded before it enters a payload;
3. **every response, from every tool, passes one final postcondition**
   (`enforceResponseCap`), after any variant-specific shrinking.

The third point is the one that carries the guarantee. Field-by-field bounds fix
the cases we know about; the postcondition covers the ones we do not, and the
failure mode it exists for is a _new_ variant carrying one unbounded field —
invisible until the transport cuts the JSON. Bounding `ref` and `anchor` left
`pathname` unbounded for exactly that reason, and a valid 40,000-character route
serialized to 42,057 characters.

Some responses cannot be shrunk at all. `doc.title` and `doc.permalink` come
from a corpus that passed every integrity and semantic check, so a document with
a 16,000-character authored title produced a 32,394-character `ok` after its
Markdown had already been reduced to nothing. There is no smaller true answer,
so the postcondition returns `response_too_large` — a typed, actionable failure
— rather than an oversized success. `__tests__/response-cap.test.ts` sweeps every
public variant of all three tools through the postcondition and asserts the set
of variants it covered, so a status added by #478/#479 fails there rather than
silently narrowing the sweep.

A trimmed outline on a _successful_ read is reported by its own
`outlineTruncated` flag, never through the content-truncation fields: those
describe the document text, and overloading them produced `truncated: true`
beside `omittedCharacterCount: 0` while what was actually omitted was metadata.

## Selection

`selection.ts` picks one of three, in the order the tools try them:

- **`section`** — an anchor was requested;
- **`full`** — the whole document fits;
- **`balanced_overview`** — it does not.

Every rule below was chosen against this site's **real** corpus: all 28 authored
documents driven through `normalizeDocumentation`, including the
`>54,000`-character `plugins-and-tools/plugin-infrastructure.md` the
balanced-overview requirement is written around. Fixtures are built the same way
(`__tests__/site-artifact-fixture.ts`) rather than hand-written, following the
#476 review's finding that a fictional corpus cannot disagree with reality.

### Overview units: the preamble, then each outline root

Three properties of the real corpus decide this:

- every document's H1 spans the whole document (depth 1, `endOffset ===
markdown.length`, no anchor since theme-classic renders no fragment id on an
  H1), so depth-1 sections are useless as overview units;
- authored content exists that no outline entry covers — in
  `plugin-infrastructure.md` the H1 and its lead prose occupy `[0, 3147)`, before
  the first outline root. An overview built from outline roots alone would
  silently drop the document's own introduction;
- an outline root's section already spans its descendants, so no recursion is
  needed. The response's flat `outline` still exposes nested headings, so a
  follow-up targeted read stays possible.

That gives 14 slices for the 54k document.

The slices **tile the document exactly**. Anything an outline root does not
cover — the preamble, and the gap between one root's end and the next root's
heading when a container opens in between — becomes its own slice, balanced by
appending the syntax it leaves open. An earlier revision instead ended the
preamble where a container opened, which deleted the authored prose between
`:::note` and the first heading beneath it.

That tiling is what the truncation accounting is derived from:
`omittedCharacterCount` is the count of source characters no slice represents,
and `truncated` is exactly `omitted > 0`. Deriving `truncated` from whether the
surviving slices needed a local cut is what let a response report
`truncated: false, omittedCharacterCount: 0` while content had been discarded
before allocation ever ran.

### Allocation: one max-min fair pass

Everything gets an equal share; what a slice does not need is redistributed to
the ones that do. Measured at a 20,000-character budget on the 54k document:

| Policy                                    | Budget used                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Proportional to section size              | 63% — small sections reduced to 400-character slivers, one real section to 21 characters |
| **Max-min fair (water-filling)**          | **~97%**                                                                                 |
| Water-filling + 2–4 redistribution passes | 101% (overshoots the cap) — i.e. buys nothing                                            |

Redistribution passes are therefore not implemented. What matters about max-min
fairness is the _floor_ it guarantees: a slice given less than a heading and a
sentence contributes nothing to an overview.

### One primitive, structure-aware

All three selections go through `boundedSlice`. That is the point rather than
tidiness: a second path slicing raw offsets does not know about the container
wrappers the corpus records, and #474 deliberately preserves directives. An
earlier revision had exactly that split, and both halves were wrong — an
oversized section authored inside `:::note` came back opening the admonition and
never closing it, while the balanced overview ignored `selectionPrefix`/
`selectionSuffix` entirely and sliced raw Markdown.

`boundedSlice` scans the prefix **together with** the source (a section's
container opens in its prefix, not in its slice), tracks source offsets
separately from emitted characters, and computes the emitted length **exactly**
for each candidate cut — because the syntax that must be appended depends on
where the cut lands. Estimating it returned 25 characters for a budget of 21.

On the truncation path the recorded `selectionSuffix` is deliberately dropped:
it closes exactly the containers an _untruncated_ slice leaves open, and once
the slice is cut the still-open set is different. The scanner's own closers are
that set.

### What the line scanner recognises, and what it cannot

The scanner is a line scanner, so the constructs it recognises are a contract:
one it fails to recognise is one it fails to close. It handles fenced code
blocks and container directives, each carrying whatever blockquote markers and
indentation its opening line had — so `> :::note[Quoted]` closes as `> :::`, and
a directive nested in a list closes at the indentation it opened at. A closing
marker must carry the same blockquote prefix and be indented no more than three
spaces past its opener, which is what keeps a deeper-indented ``` _inside_ a
fence (a document documenting Markdown) from being read as that fence's closer.

Indentation is otherwise unbounded rather than CommonMark's three spaces. That
is a deliberate trade in one direction: a fence or directive nested in a list is
common and would otherwise go unrecognised and unclosed, while the cost is that
a fence line inside a 4-space **indented code block** would be read as a real
fence. No document on this site authors an indented code block; several nest
constructs in lists.

Some line starts are not legal cuts at all, because the line _after_ the cut is
what makes the line _before_ it mean what it says:

- a GFM table's delimiter row — cutting between a header and its delimiter turns
  the promised table into a paragraph. Measured at budgets 42–55 on a real
  table, the response was `| A | B |` alone;
- a setext underline, for the same reason.

The long-term answer is to derive safe cut points and required closing syntax
from the Markdown AST during #474 corpus construction, where a real parser is
already running. That is a corpus-contract change rather than a bounded fix, and
is recorded as follow-up work rather than done here.

### Truncation: cut at a line boundary, close the fence

A cut is always a line start — never mid-line, so no list marker, table row, or
link is severed — and when it lands inside a fenced block, the fence is **closed**
rather than the cut abandoned. A fence closes _before_ the truncation marker so
the marker is not rendered as code; containers close _after_ it, so the marker
reads as prose inside the admonition it was cut out of.

That rule is not a detail:

| Rule                                                                           | Result                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retreat to before the block's opening                                          | 71% utilisation; `self-hosting/litellm-setup.md`'s Troubleshooting came back as **20 characters** — its heading alone — because a block starts right after the heading |
| **Cut at a line boundary, emit the closing fence and a `…[truncated]` marker** | **~97%**, and the returned Markdown is always independently valid                                                                                                      |
| Skip the oversized block and continue with later prose                         | reorders authored content and misrepresents the document                                                                                                               |

A paragraph boundary is preferred when reaching one costs little — capped at an
eighth of the budget. An unbounded retreat was measured at 16,112 returned
characters instead of 19,299, spending a fifth of the budget on whitespace
alignment; the `…[truncated]` marker already tells the reader the text was cut.
Truncated GFM tables need nothing special: a header, its separator, and whole
rows are already a valid table.

## Failure vocabulary

| Status / code                        | Meaning                                                               | Retryable |
| ------------------------------------ | --------------------------------------------------------------------- | --------- |
| `ok`                                 | Includes a zero-result search and a fully-returned document           | —         |
| `not_on_doc_page`                    | The route has no authored document                                    | No        |
| `unavailable`                        | Current-document identity could not be established                    | Depends   |
| `error` / `manifest_unavailable`     | The corpus manifest could not be fetched, or was never published      | Depends   |
| `error` / `manifest_incompatible`    | A manifest was reached but does not match this build's contract       | No        |
| `error` / `document_not_found`       | No corpus document has that `ref`                                     | No        |
| `error` / `document_unavailable`     | The document artifact could not be fetched                            | Yes       |
| `error` / `document_invalid`         | The artifact does not match the #474 schema, or is another document's | No        |
| `error` / `content_hash_mismatch`    | The artifact's bytes are not what the manifest recorded               | No        |
| `error` / `section_not_found`        | No such anchor — the response carries the available `outline`         | No        |
| `error` / `response_too_large`       | Irreducible metadata exceeds the transport limit (see above)          | No        |
| `search_unavailable` / _(#475 code)_ | Retrieval could not run                                               | Depends   |

## Artifact validity has one definition

`artifact-invariants.ts` is the single answer to "is this artifact internally
consistent?", used by both `validate-corpus.ts` at build time and the runtime
artifact store. It checks the synthetic whole-document section, section
positions, offsets, character counts, anchor uniqueness, and the **bijection**
between the outline and the addressable sections — the relationships selection
reads as if they agreed, none of which a type can express and none of which
throws when violated. A bad `sectionIndex` does not fail; it silently produces
an overview of the wrong parts of a document.

The bijection has to hold in both directions. "Every outline entry resolves to a
matching section" is satisfied by an artifact with _no outline at all_, and that
is the worst case rather than a harmless one: the balanced overview is built
from outline roots, so an empty outline degrades it to a single slice from the
start of the document — exactly the first-N-characters behaviour #477 forbids,
reached silently with every other check passing. Ordering, depth, and
parent/child agreement are validated alongside it, since the flattened outline
is presented to a model as the page's structure.

The store adds only the checks that need both sides: the recomputed byte hash,
and the manifest summary. Those report `identity` (this is a different document)
apart from `content` (this is not what the manifest recorded), so the two map to
different failure codes rather than being re-derived from which field differed.

Keeping a third interpretation in the store would have been the kind of drift
#482 later asks us to remove, and it is much cheaper to avoid before #478 and
#479 consume the API.

## What is not here

- Grounding instructions, the citation ledger, and the `Sources` footer (#478).
- The assistant session and its tool picker (#479), and the widget (#480).
- Any use of live-lab output, conversation, or tool state — #477 excludes all
  three, and `__tests__/source-rules.test.ts` enforces it.
