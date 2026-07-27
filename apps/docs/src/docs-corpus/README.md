# Authored documentation corpus

`documentationCorpusPlugin` builds the canonical Markdown corpus used by
assistant documentation tools. Identity and visibility come from Docusaurus'
loaded `DocMetadata`; content comes from the corresponding source Markdown/MDX
file. Rendered HTML, browser state, and the DOM are never inputs.

## Output

The plugin puts only a tiny hashed-manifest locator in Docusaurus global data.
The client compiler emits the same assets in development and production:

- `assets/docs-corpus/manifest.v1.<sha256>.json`
- one `assets/docs-corpus/documents/<ref>.<ref-hash>.<artifact-hash>.json` per
  authored, non-draft document

Document paths are addressed by a SHA-256 of the complete serialized artifact
(not only its Markdown), so title, outline, boundary, or normalization changes
cannot leave stale JSON behind an immutable-looking URL. Changing one document
leaves every unrelated document URL cacheable. Unlisted documents remain in
the manifest with `unlisted: true`; Docusaurus drafts never enter the corpus.
No document artifact is imported by a page bundle or fetched during initial
page loading. `postBuild` verifies emitted bytes, hashes, canonical links, and
anchors against the static Docusaurus output; rendered HTML is a build
assertion only and is never an input to corpus content.

## Runtime store

`manifest-store.ts` is the single browser-side reader of everything above. It
discovers the locator through `@generated/globalData`, fetches the manifest,
validates the **complete** `DocumentationCorpusManifestEntry` contract (not just
one consumer's slice), verifies integrity, caches the result, and answers
lookups — `findByPermalink` for a canonical page URL and `findByRef(ref,
version?)` for a Docusaurus document id.

Every documentation consumer goes through it. `#475` search projects it down to
canonical-version permalinks (`docs-search/corpus-ref-map.ts`); `#477`'s
`read_doc` needs the same entries' `artifact`/`artifactHash` to load a body,
reached by the very `ref` a search result returned. A second locator reader,
validator, cache and retry policy for one resource is exactly the drift the
store exists to prevent, so consumers add projections to it rather than
re-reading the manifest.

Integrity means what it says: the store recomputes the SHA-256 that
`build-corpus.ts` advertises — over `JSON.stringify({ schemaVersion, documents
})`, the manifest without its own hash field — instead of only checking that the
locator's `manifestHash` and the payload's agree. Both of those are
self-reported, so agreement proves nothing about a payload served from a
content-addressed URL. `crypto.subtle` is secure-context only; where it is
absent the store degrades to the string comparison rather than losing retrieval
entirely.

Caching is keyed by manifest URL, manifest hash, base URL and trailing-slash
policy, so one caller's site config can never decide another's normalization,
and a redeploy's new locator is never served from a stale entry. Retryable
(network/HTTP) failures are evicted immediately; schema and integrity failures
are stable and stay cached.

### Version policy

Docusaurus permits the same document id in multiple loaded versions. The corpus
includes all of them and uses `(version, ref)` as its unique internal identity,
while the approved caller-facing `ref` remains the unqualified Docusaurus id.
Manifest entries carry `version`, canonical `versionPath`, and `isLast`.
Unqualified reads select the one `isLast` version; route-aware reads can select
historical or upcoming content by version and canonical permalink. A missing
or duplicated `isLast` version fails the build.

Visibility always comes from authored `frontMatter.draft` and
`frontMatter.unlisted`, because Docusaurus neutralizes the derived metadata
flags during `docusaurus start`. This keeps development and production corpora
identical: drafts are absent and unlisted documents remain directly readable.

## Deterministic normalization

Normalization is deliberately small and source-preserving:

1. Strip a UTF-8 BOM, convert CRLF/CR line endings to LF, trim outer whitespace,
   and end non-empty output with one LF.
2. Parse `.md` as Markdown and `.mdx` as MDX with the AST stack used for authored
   syntax: GFM, Docusaurus-compatible comments, frontmatter, and directives
   (Docusaurus admonitions).
3. Remove YAML/TOML frontmatter and MDX ESM (`import`/`export`) nodes.
4. Strip hidden HTML/remark comments and comment-only MDX expressions. Retain
   only heading-id comments, which are declarative anchor syntax.
5. Replace MDX JSX and executable expression nodes with an explicit
   non-executable Markdown marker. Never evaluate a component or serialize its
   rendered output.
6. Otherwise preserve authored prose, headings, links, GFM, directives, and
   fenced code. Classic `{#id}` heading suffixes are escaped as `\{#id}` before
   MDX parsing, matching Docusaurus semantics; fenced code is excluded from
   that preprocessing.
7. Walk AST heading nodes in document order and use Docusaurus' pinned
   `github-slugger` algorithm. Explicit ids and duplicate generated ids follow
   Docusaurus behavior. Because headings come from the AST, `#` inside a code
   fence never becomes a section.

Theme-classic does not render fragment ids on H1 elements. H1 headings still
create section boundaries and participate in duplicate-slug accounting, but
their section anchor is `null` and they are omitted from the addressable
outline. Every non-null anchor is therefore a fragment present in the built
page.

Offsets in artifacts are JavaScript/JSON UTF-16 string offsets. Section zero
covers the whole document. Each named section starts at its heading and ends at
the next heading of equal or smaller depth, so it includes descendant sections.
Named-section readers construct independently valid Markdown as
`selectionPrefix + markdown.slice(startOffset, endOffset) + selectionSuffix`.
Heading starts include their authored line prefix, preserving blockquote and
list nesting. Explicit container ancestors such as admonitions are recorded as
opening and closing selection wrappers; boundaries move before a newly opened
container so neither adjacent selection receives an unmatched delimiter. The
nested outline and parent anchors support named-section reads and later
balanced-overview selection. Bounded readers must return the shared
`DocumentationCorpusReadTruncation` metadata rather than silently cutting text.
