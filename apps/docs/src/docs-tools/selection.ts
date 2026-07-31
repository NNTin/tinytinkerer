/**
 * Turning a #474 document artifact into a bounded, Markdown-valid selection.
 *
 * Three selections exist, in the order `read_doc`/`read_current_doc` try them:
 *
 * - `section` — a named anchor was requested;
 * - `full` — the whole document fits the budget;
 * - `balanced_overview` — it does not, so the budget is spread across the
 *   document's top-level structure rather than spent on its first N characters.
 *
 * All three go through one primitive, `boundedSlice`. That is the point: a
 * second path slicing raw offsets would not know about the container wrappers
 * the corpus records, and #474 deliberately preserves directives. `boundedSlice`
 * tracks source offsets separately from emitted characters and reserves **every**
 * mandatory piece of syntax — the section's wrapper prefix and suffix, any fence
 * or container it cuts into, and the truncation marker — before choosing where
 * to cut. So the result is both independently valid Markdown and genuinely
 * within budget.
 *
 * Every rule below was chosen against this site's real corpus (all 28 authored
 * documents driven through `normalizeDocumentation`), not invented fixtures —
 * including `plugins-and-tools/plugin-infrastructure.md`, the >54,000-character
 * document #477's overview requirement is built around. The measurements are
 * recorded in docs-tools/README.md and on the issue.
 */
import type {
  DocumentationCorpusDocumentArtifact,
  DocumentationCorpusOutlineItem,
  DocumentationCorpusReadTruncation,
  DocumentationCorpusSection
} from '@tinytinkerer/app-browser/documentation-corpus'

/** Marks where text was cut. Kept short: it is reserved from the same budget. */
const TRUNCATION_MARKER = '\n\n…[truncated]\n'

/**
 * How far a cut may retreat to reach a paragraph break. A paragraph boundary
 * reads better, but an unbounded retreat was measured spending about a fifth of
 * the budget on whitespace alignment (16,112 returned characters instead of
 * 19,299 on the oversized document), and a section opening with one long code
 * block has no paragraph break inside the budget at all.
 */
const PARAGRAPH_RETREAT_DIVISOR = 8

export type DocumentationOutlineEntry = { heading: string; level: number; anchor: string }

export type DocumentationSelectionSection = {
  heading?: string
  anchor?: string
  markdown: string
}

export type DocumentationSelectionKind = 'full' | 'balanced_overview' | 'section'

export type DocumentationSelection = {
  selection: DocumentationSelectionKind
  sections: DocumentationSelectionSection[]
  truncation: DocumentationCorpusReadTruncation
}

/**
 * The nested corpus outline flattened into document order.
 *
 * `level` is the authored Markdown heading depth, so the hierarchy survives the
 * flattening — a model reading `level: 3` under `level: 2` sees the nesting
 * without having to walk a tree, and every entry stays directly usable as an
 * `anchor` argument. The corpus already omits H1s, which theme-classic renders
 * with no fragment id, so every anchor here is a link target that exists.
 */
export const flattenOutline = (
  items: readonly DocumentationCorpusOutlineItem[]
): DocumentationOutlineEntry[] =>
  items.flatMap((item) => [
    { heading: item.title, level: item.depth, anchor: item.anchor },
    ...flattenOutline(item.children)
  ])

// ---------------------------------------------------------------------------
// Structure scanning
// ---------------------------------------------------------------------------

/**
 * A block construct that spans lines and therefore needs closing syntax if the
 * text is cut while it is open.
 *
 * `linePrefix` is the exact text before the marker on the opening line — the
 * blockquote markers and indentation a nested construct carries. Reusing it
 * verbatim for the closer is what makes `> :::note` close as `> :::` rather
 * than as a bare `:::` that is no longer inside the quote.
 */
type OpenConstruct = { kind: 'fence' | 'container'; marker: string; linePrefix: string }

/**
 * What must be appended to make text ending at a given point self-contained.
 *
 * Fence and container closers are kept apart because they belong on opposite
 * sides of the truncation marker: a fence has to close *immediately*, or the
 * marker renders as code, while a container closes *after* it, so the marker is
 * visible prose inside the admonition it was cut out of.
 *
 * A fence is always innermost — directive lines inside a code block are code,
 * not syntax — so there is at most one fence closer.
 */
type LineClosers = { fence: string; containers: string }

type LineStructure = {
  starts: number[]
  closers: LineClosers[]
  /**
   * Line starts that must never be cut at, because the line *after* the cut is
   * what makes the line *before* it mean what it says.
   */
  unsafeCut: boolean[]
  /** Closers for the whole text, i.e. for a cut at its very end. */
  trailing: LineClosers
}

/**
 * Blockquote markers and indentation, which every block construct may carry.
 *
 * The indent is deliberately unbounded rather than CommonMark's three spaces:
 * the corpus preserves authored Markdown, and a fence or directive nested in a
 * list is indented to its item. Bounding it at three would miss those openers
 * and emit an admonition that never closes — the failure this scanner exists to
 * prevent. The cost is that a fence line inside a *4-space indented code block*
 * would be read as a real fence; closers stay bounded relative to their opener
 * (below) so the common case of documenting fences *inside* a fence is
 * unaffected, and this site's corpus authors no indented code blocks at all.
 */
const LINE_PREFIX = /^((?:[ \t]*>)*)([ \t]*)/
const FENCE_MARKER = /^(`{3,}|~{3,})/
const FENCE_CLOSE_MARKER = /^(`{3,}|~{3,})[ \t]*$/
const CONTAINER_OPEN_MARKER = /^(:{3,})[A-Za-z]/
const CONTAINER_CLOSE_MARKER = /^(:{3,})[ \t]*$/

/** How much further than its opener a closing marker may be indented. */
const CLOSER_INDENT_SLACK = 3

type ParsedLine = { linePrefix: string; quote: string; indent: number; body: string }

const parseLine = (line: string): ParsedLine => {
  const match = LINE_PREFIX.exec(line)
  const quote = match?.[1] ?? ''
  const spaces = match?.[2] ?? ''
  return {
    linePrefix: `${quote}${spaces}`,
    quote: quote.replace(/[ \t]/g, ''),
    indent: spaces.length,
    body: line.slice(quote.length + spaces.length)
  }
}

const closes = (open: OpenConstruct, line: ParsedLine): boolean =>
  parseLine(open.linePrefix).quote === line.quote &&
  line.indent <= parseLine(open.linePrefix).indent + CLOSER_INDENT_SLACK

const closersFor = (stack: readonly OpenConstruct[]): LineClosers => {
  const top = stack.at(-1)
  return {
    fence: top?.kind === 'fence' ? `${top.linePrefix}${top.marker}\n` : '',
    containers: stack
      .filter((item) => item.kind === 'container')
      .reverse()
      .map((item) => `${item.linePrefix}${item.marker}\n`)
      .join('')
  }
}

/**
 * A GFM table's delimiter row. Cutting between a header row and this line turns
 * the promised table into a paragraph, so the line start it begins at is not a
 * legal cut. Requiring a pipe is what keeps a bare `---` thematic break out.
 */
const isTableDelimiter = (line: string): boolean =>
  line.includes('|') && line.includes('-') && /^[\s|:-]+$/.test(line)

/** A setext underline, which likewise turns into a paragraph without its text. */
const isSetextUnderline = (line: string, previous: string): boolean =>
  previous.trim().length > 0 && /^ {0,3}(=+|-+)[ \t]*$/.test(line)

const scanStructure = (text: string): LineStructure => {
  const starts: number[] = []
  const closers: LineClosers[] = []
  const unsafeCut: boolean[] = []
  const stack: OpenConstruct[] = []
  const lines = text.split('\n')
  let offset = 0

  lines.forEach((line, index) => {
    starts.push(offset)
    closers.push(closersFor(stack))
    const parsed = parseLine(line)
    const insideFence = stack.at(-1)?.kind === 'fence'
    unsafeCut.push(
      !insideFence &&
        index > 0 &&
        (isTableDelimiter(line) || isSetextUnderline(line, lines[index - 1]))
    )

    const top = stack.at(-1)
    if (top?.kind === 'fence') {
      const close = FENCE_CLOSE_MARKER.exec(parsed.body)
      if (
        close &&
        close[1][0] === top.marker[0] &&
        close[1].length >= top.marker.length &&
        closes(top, parsed)
      ) {
        stack.pop()
      }
    } else {
      const fence = FENCE_MARKER.exec(parsed.body)
      const closeContainer = CONTAINER_CLOSE_MARKER.exec(parsed.body)
      const openContainer = CONTAINER_OPEN_MARKER.exec(parsed.body)
      if (fence) stack.push({ kind: 'fence', marker: fence[1], linePrefix: parsed.linePrefix })
      else if (closeContainer && top?.kind === 'container' && closes(top, parsed)) stack.pop()
      else if (openContainer)
        stack.push({ kind: 'container', marker: openContainer[1], linePrefix: parsed.linePrefix })
    }
    offset += line.length + 1
  })

  return { starts, closers, unsafeCut, trailing: closersFor(stack) }
}

/**
 * The syntax `text` needs appended to stand alone.
 *
 * The balanced overview's gap slices use it. A span that ends inside an
 * admonition — the `:::note` opener and the prose beneath it, before the first
 * heading — is authored content, and an earlier version deleted it rather than
 * closing it. Closing it is the same thing the corpus already does for a
 * section through `selectionSuffix`, so nothing new is invented here.
 */
const trailingSyntax = (text: string): string => {
  const { trailing } = scanStructure(text)
  return `${trailing.fence}${trailing.containers}`
}

// ---------------------------------------------------------------------------
// The bounded-slice primitive
// ---------------------------------------------------------------------------

export type BoundedSlice = {
  /** Emitted Markdown: independently valid, and never longer than the budget. */
  markdown: string
  /** How many characters of `source` were included, in source offsets. */
  consumedSourceChars: number
  truncated: boolean
}

const isParagraphBoundary = (text: string, offset: number): boolean =>
  /\n[ \t]*\n$/.test(text.slice(Math.max(0, offset - 2), offset))

/**
 * Bounds `prefix + source + suffix` to `budget` characters at a Markdown-safe
 * boundary.
 *
 * The cut is always a line start — never mid-line, so no list marker, table row,
 * or link is severed — and the emitted length is computed **exactly** for each
 * candidate rather than estimated, because the syntax that must be appended
 * depends on where the cut lands. An earlier version reserved only the marker
 * and then appended a fence closer, which returned 25 characters for a budget
 * of 21.
 *
 * Closing a fence rather than retreating past it is what makes the budget usable
 * at all: retreating measured 71% utilisation against ~97%, and reduced a
 * section whose code block starts right after its heading to the heading alone.
 * Truncated GFM tables need nothing special — a header, its separator, and whole
 * rows are already a valid table.
 */
export const boundedSlice = (options: {
  source: string
  prefix?: string
  suffix?: string
  budget: number
}): BoundedSlice => {
  const { source, prefix = '', suffix = '', budget } = options
  const whole = `${prefix}${source}${suffix}`
  if (whole.length <= budget) {
    return { markdown: whole, consumedSourceChars: source.length, truncated: false }
  }

  // Scanned **with** the prefix, not just the source. A section's
  // `selectionPrefix` is where its container opens — `:::note` lives there, not
  // in the slice — so scanning the source alone would find nothing to close and
  // emit an opener with no closer.
  const combined = `${prefix}${source}`
  const { starts, closers, unsafeCut } = scanStructure(combined)

  const emittedLength = (index: number): number =>
    starts[index] +
    closers[index].fence.length +
    TRUNCATION_MARKER.length +
    closers[index].containers.length

  let cut = -1
  let paragraphCut = -1
  for (let index = 1; index < starts.length; index += 1) {
    // Candidates start after the prefix: cutting into it would emit a partial
    // opener, and the prefix is mandatory syntax rather than content.
    if (starts[index] < prefix.length) continue
    // Strictly inside the source, so a truncated slice always leaves something
    // out. A cut at the very end would emit the truncation marker while having
    // consumed everything, making `truncated` disagree with the accounting.
    if (starts[index] >= combined.length) continue
    // A cut that would strand a table header without its delimiter row, or a
    // setext heading without its underline.
    if (unsafeCut[index]) continue
    // Not a `break`: the closing syntax a cut needs varies with the cut, so a
    // later candidate can fit where an earlier one did not.
    if (emittedLength(index) > budget) continue
    cut = index
    if (isParagraphBoundary(combined, starts[index])) paragraphCut = index
  }
  if (cut < 0) return { markdown: '', consumedSourceChars: 0, truncated: true }

  const allowance = Math.floor(budget / PARAGRAPH_RETREAT_DIVISOR)
  const chosen =
    paragraphCut > 0 && starts[cut] - starts[paragraphCut] <= allowance ? paragraphCut : cut

  // `suffix` is deliberately dropped on this path. It closes exactly the
  // containers the *untruncated* slice leaves open; once the slice is cut, the
  // set still open is different, and `closers` is that set. Emitting both would
  // close some of them twice.
  const { fence, containers } = closers[chosen]
  return {
    markdown: `${combined.slice(0, starts[chosen])}${fence}${TRUNCATION_MARKER}${containers}`,
    consumedSourceChars: starts[chosen] - prefix.length,
    truncated: true
  }
}

/** `boundedSlice` over a bare span, kept as a named primitive for its own tests. */
export const truncateMarkdown = (text: string, budget: number): string =>
  boundedSlice({ source: text, budget }).markdown

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

/**
 * Max-min fair ("water-filling") allocation of `budget` across `sizes`.
 *
 * Everything gets an equal share; whatever a slice does not need is
 * redistributed to the ones that do, repeatedly. This is what guarantees a floor
 * — the property that matters, because a slice given less than a heading plus a
 * sentence contributes nothing to an overview.
 *
 * Allocating proportionally to section size instead was measured at 63% budget
 * utilisation on the 54,000-character document, with small sections reduced to
 * 400-character slivers and one real section to 21 characters. A redistribution
 * pass after truncation was also measured, and buys nothing: a single pass
 * already reaches ~97% on every document that needs selection.
 */
export const allocateBudget = (sizes: readonly number[], budget: number): number[] => {
  const allocation = sizes.map(() => 0)
  let open = sizes.map((_, index) => index)
  let remaining = budget

  while (open.length > 0 && remaining > 0) {
    const share = Math.floor(remaining / open.length)
    if (share <= 0) break
    const satisfied = open.filter((index) => sizes[index] <= share)
    if (satisfied.length === 0) {
      for (const index of open) allocation[index] = share
      break
    }
    for (const index of satisfied) {
      allocation[index] = sizes[index]
      remaining -= sizes[index]
    }
    open = open.filter((index) => sizes[index] > share)
  }

  return allocation
}

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

type OverviewSlice = {
  heading: string
  anchor: string | undefined
  source: string
  prefix: string
  suffix: string
  /** Offset of `source` within the document, for `nextSectionAnchor`. */
  documentOffset: number
  /** Emitted size when returned whole, which allocation budgets against. */
  size: number
}

/**
 * The overview's units plus the characters deliberately left unrepresented.
 *
 * The two travel together because the truncation accounting is derived from
 * coverage: every character of the document is either inside a slice, counted
 * here as elided whitespace, or reported as omitted. Returning the slices alone
 * is what previously let content vanish while the response claimed
 * `truncated: false`.
 */
type OverviewPlan = { slices: OverviewSlice[]; elidedCharacterCount: number }

/**
 * The units a balanced overview is built from: the document preamble, then one
 * slice per top-level outline entry, each carrying the container wrappers the
 * corpus recorded for it.
 *
 * Three properties of the real corpus decide this shape:
 *
 * - every document's H1 spans the whole document (depth 1, `endOffset ===
 *   markdown.length`, and no anchor, since theme-classic renders no fragment id
 *   on an H1), so depth-1 sections are useless as overview units;
 * - authored content exists that no outline entry covers. In
 *   `plugin-infrastructure.md` the H1 and its lead prose occupy `[0, 3147)`,
 *   before the first outline root — an overview built only from outline roots
 *   would silently drop the document's own introduction;
 * - an outline root's section already spans its descendants, so no recursion is
 *   needed here. The response's flat `outline` still exposes nested headings, so
 *   a follow-up targeted read remains possible.
 *
 * The spans **tile the document exactly**: a gap between roots — the `:::note`
 * opener line and any prose before the next heading — becomes its own slice,
 * balanced by `trailingSyntax`, rather than being clipped away. That is the
 * property the truncation accounting below is derived from, so authored text
 * can no longer disappear silently.
 */
const overviewSlices = (artifact: DocumentationCorpusDocumentArtifact): OverviewPlan => {
  const roots = artifact.outline.flatMap((item) => {
    const section = artifact.sections[item.sectionIndex]
    return section ? [section] : []
  })

  type Span = { start: number; end: number; section?: DocumentationCorpusSection }
  const spans: Span[] = []
  let cursor = 0
  for (const section of roots) {
    // Clamped rather than trusted: overlapping roots would break the tiling, and
    // the shared artifact validator rejects them before this ever runs.
    const start = Math.max(cursor, section.startOffset)
    const end = Math.max(start, section.endOffset)
    if (start > cursor) spans.push({ start: cursor, end: start })
    spans.push({ start, end, section })
    cursor = end
  }
  if (cursor < artifact.markdown.length) {
    spans.push({ start: cursor, end: artifact.markdown.length })
  }

  const slices: OverviewSlice[] = []
  let elidedCharacterCount = 0
  for (const span of spans) {
    const source = artifact.markdown.slice(span.start, span.end)
    if (!span.section) {
      // Whitespace between structural units carries no authored content, so
      // leaving it out is not omission — but it is still counted, because the
      // accounting below asserts that every character is accounted for.
      if (source.trim().length === 0) {
        elidedCharacterCount += source.length
        continue
      }
      const suffix = trailingSyntax(source)
      slices.push({
        heading: span.start === 0 ? (artifact.sections[0]?.title ?? '') : '',
        anchor: undefined,
        source,
        prefix: '',
        suffix,
        documentOffset: span.start,
        size: source.length + suffix.length
      })
      continue
    }
    const { selectionPrefix, selectionSuffix } = span.section
    slices.push({
      heading: span.section.title,
      anchor: span.section.anchor ?? undefined,
      source,
      prefix: selectionPrefix,
      suffix: selectionSuffix,
      documentOffset: span.start,
      size: selectionPrefix.length + source.length + selectionSuffix.length
    })
  }
  return { slices, elidedCharacterCount }
}

/**
 * Truncation metadata derived from **source coverage**, never from whether a
 * slice happened to need a local cut.
 *
 * `omittedCharacterCount` is the caller's count of source characters no slice
 * represents, so `truncated` is exactly `omitted > 0`. An earlier version set
 * `truncated` from the bounded slices alone, which reported `truncated: false`
 * with `omittedCharacterCount: 0` for a document whose prologue had been
 * discarded before allocation ever ran.
 */
const truncationOf = (
  sourceCharacterCount: number,
  omittedCharacterCount: number,
  sections: readonly DocumentationSelectionSection[],
  nextSectionAnchor: string | null
): DocumentationCorpusReadTruncation => {
  const omitted = Math.max(0, omittedCharacterCount)
  return {
    truncated: omitted > 0,
    sourceCharacterCount,
    returnedCharacterCount: sections.reduce((total, item) => total + item.markdown.length, 0),
    omittedCharacterCount: omitted,
    nextSectionAnchor: omitted > 0 ? nextSectionAnchor : null
  }
}

/**
 * The anchor a follow-up read should target: the first *addressable* section in
 * document order whose content was not returned in full. Null when nothing was
 * omitted, or when what was omitted has no anchor to ask for.
 */
const nextAnchorAfter = (
  artifact: DocumentationCorpusDocumentArtifact,
  offset: number
): string | null =>
  artifact.sections.find((section) => section.anchor !== null && section.startOffset >= offset)
    ?.anchor ?? null

/** The whole document, truncated at a safe boundary if it overruns. */
const selectFull = (
  artifact: DocumentationCorpusDocumentArtifact,
  budget: number
): DocumentationSelection => {
  const slice = boundedSlice({ source: artifact.markdown, budget })
  const heading = artifact.sections[0]?.title
  const sections: DocumentationSelectionSection[] = [
    { ...(heading ? { heading } : {}), markdown: slice.markdown }
  ]
  return {
    selection: 'full',
    sections,
    truncation: truncationOf(
      artifact.markdown.length,
      artifact.markdown.length - slice.consumedSourceChars,
      sections,
      nextAnchorAfter(artifact, slice.consumedSourceChars)
    )
  }
}

/** One named section, with the container wrappers the corpus recorded for it. */
export const selectSection = (
  artifact: DocumentationCorpusDocumentArtifact,
  section: DocumentationCorpusSection,
  budget: number
): DocumentationSelection => {
  const span = artifact.markdown.slice(section.startOffset, section.endOffset)
  const slice = boundedSlice({
    source: span,
    prefix: section.selectionPrefix,
    suffix: section.selectionSuffix,
    budget
  })
  const sections: DocumentationSelectionSection[] = [
    {
      heading: section.title,
      ...(section.anchor ? { anchor: section.anchor } : {}),
      markdown: slice.markdown
    }
  ]
  return {
    selection: 'section',
    sections,
    truncation: truncationOf(
      section.characterCount,
      span.length - slice.consumedSourceChars,
      sections,
      // Where the returned text stopped inside the document, so the suggestion
      // is a section the reader has not already been shown.
      nextAnchorAfter(artifact, section.startOffset + slice.consumedSourceChars)
    )
  }
}

/**
 * The budget spread across the document's top-level structure, so an oversized
 * document comes back as a real overview instead of its first N characters.
 * Headings and anchors are preserved for every slice, so any of them can be
 * requested in full by a follow-up `read_doc(ref, anchor)`.
 */
const selectBalancedOverview = (
  artifact: DocumentationCorpusDocumentArtifact,
  budget: number
): DocumentationSelection => {
  const { slices, elidedCharacterCount } = overviewSlices(artifact)
  const allocation = allocateBudget(
    slices.map((slice) => slice.size),
    budget
  )

  let coveredCharacterCount = elidedCharacterCount
  let firstOmittedOffset: number | undefined
  const sections = slices.map((slice, index) => {
    const bounded = boundedSlice({
      source: slice.source,
      prefix: slice.prefix,
      suffix: slice.suffix,
      budget: allocation[index]
    })
    coveredCharacterCount += bounded.consumedSourceChars
    if (bounded.consumedSourceChars < slice.source.length && firstOmittedOffset === undefined) {
      firstOmittedOffset = slice.documentOffset + bounded.consumedSourceChars
    }
    return {
      ...(slice.heading ? { heading: slice.heading } : {}),
      ...(slice.anchor ? { anchor: slice.anchor } : {}),
      markdown: bounded.markdown
    }
  })

  return {
    selection: 'balanced_overview',
    sections,
    // From coverage of the source, not from whether any slice needed a cut: the
    // spans tile the document, so this is the exact count of characters the
    // reader was not shown.
    truncation: truncationOf(
      artifact.markdown.length,
      artifact.markdown.length - coveredCharacterCount,
      sections,
      nextAnchorAfter(artifact, firstOmittedOffset ?? artifact.markdown.length)
    )
  }
}

/**
 * Picks the selection for an unanchored read: the whole document when it fits,
 * a balanced overview when it does not.
 */
export const selectDocument = (
  artifact: DocumentationCorpusDocumentArtifact,
  budget: number
): DocumentationSelection =>
  artifact.markdown.length <= budget
    ? selectFull(artifact, budget)
    : selectBalancedOverview(artifact, budget)
