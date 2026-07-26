# Authored documentation corpus

`documentationCorpusPlugin` builds the canonical Markdown corpus used by
assistant documentation tools. Identity and visibility come from Docusaurus'
loaded `DocMetadata`; content comes from the corresponding source Markdown/MDX
file. Rendered HTML, browser state, and the DOM are never inputs.

## Output

The plugin puts only a tiny hashed-manifest locator in Docusaurus global data.
At production `postBuild`, it writes:

- `assets/docs-corpus/manifest.v1.<sha256>.json`
- one `assets/docs-corpus/documents/<ref>.<ref-hash>.<artifact-hash>.json` per
  authored, non-draft document

Document paths are addressed by a SHA-256 of the complete serialized artifact
(not only its Markdown), so title, outline, boundary, or normalization changes
cannot leave stale JSON behind an immutable-looking URL. Changing one document
leaves every unrelated document URL cacheable. Unlisted documents remain in
the manifest with `unlisted: true`; Docusaurus drafts never enter the corpus.
No document artifact is imported by a page bundle or fetched during initial
page loading.

### Version policy

Docusaurus permits the same document id in multiple loaded versions, while the
approved corpus `ref` is that unqualified id. The corpus therefore deliberately
includes exactly the version marked `isLast`: Docusaurus' canonical,
non-version-prefixed served version. It does not flatten historical or upcoming
versions into an ambiguous id map. Version-qualified routes remain the concern
of the version-aware route identity layer; a missing or duplicated `isLast`
version fails the build instead of silently selecting by array order.

## Deterministic normalization

Normalization is deliberately small and source-preserving:

1. Strip a UTF-8 BOM, convert CRLF/CR line endings to LF, trim outer whitespace,
   and end non-empty output with one LF.
2. Parse `.md` as Markdown and `.mdx` as MDX with the AST stack used for authored
   syntax: GFM, Docusaurus-compatible comments, frontmatter, and directives
   (Docusaurus admonitions).
3. Remove YAML/TOML frontmatter and MDX ESM (`import`/`export`) nodes.
4. Replace MDX JSX and executable expression nodes with an explicit
   non-executable Markdown marker. Never evaluate a component or serialize its
   rendered output. MDX/HTML heading-id comments are retained because they are
   declarative anchor syntax, not executable output.
5. Otherwise preserve authored prose, headings, links, GFM, directives, and
   fenced code. Classic `{#id}` heading suffixes are escaped as `\{#id}` before
   MDX parsing, matching Docusaurus semantics; fenced code is excluded from
   that preprocessing.
6. Walk AST heading nodes in document order and use Docusaurus' pinned
   `github-slugger` algorithm. Explicit ids and duplicate generated ids follow
   Docusaurus behavior. Because headings come from the AST, `#` inside a code
   fence never becomes a section.

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
