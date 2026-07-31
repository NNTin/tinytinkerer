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

type OpenConstruct = { kind: 'fence' | 'container'; marker: string; start: number }

/**
 * What must be appended at each line start to make the text before it
 * self-contained.
 *
 * Fence and container closers are kept apart because they belong on opposite
 * sides of the truncation marker: a fence has to close *immediately*, or the
 * marker renders as code, while a container closes *after* it, so the marker is
 * visible prose inside the admonition it was cut out of.
 *
 * A fence is always innermost — directive lines inside a code block are code,
 * not syntax — so there is at most one fence closer.
 */
type LineStructure = {
  starts: number[]
  fenceCloser: string[]
  containerClosers: string[]
  /** Start of the outermost container still open at the end of the text. */
  unclosedContainerStart: number | undefined
}

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^\s{0,3}(`{3,}|~{3,})\s*$/
const CONTAINER_OPEN = /^\s{0,3}(:{3,})[A-Za-z]/
const CONTAINER_CLOSE = /^\s{0,3}(:{3,})\s*$/

const scanStructure = (text: string): LineStructure => {
  const starts: number[] = []
  const fenceCloser: string[] = []
  const containerClosers: string[] = []
  const stack: OpenConstruct[] = []
  let offset = 0

  for (const line of text.split('\n')) {
    starts.push(offset)
    const top = stack.at(-1)
    fenceCloser.push(top?.kind === 'fence' ? `${top.marker}\n` : '')
    containerClosers.push(
      stack
        .filter((item) => item.kind === 'container')
        .reverse()
        .map((item) => `${item.marker}\n`)
        .join('')
    )

    if (top?.kind === 'fence') {
      const close = FENCE_CLOSE.exec(line)
      if (close && close[1][0] === top.marker[0] && close[1].length >= top.marker.length) {
        stack.pop()
      }
    } else {
      const fence = FENCE_OPEN.exec(line)
      const closeContainer = CONTAINER_CLOSE.exec(line)
      const openContainer = CONTAINER_OPEN.exec(line)
      if (fence) stack.push({ kind: 'fence', marker: fence[1], start: offset })
      else if (closeContainer && top?.kind === 'container') stack.pop()
      else if (openContainer)
        stack.push({ kind: 'container', marker: openContainer[1], start: offset })
    }
    offset += line.length + 1
  }

  return {
    starts,
    fenceCloser,
    containerClosers,
    unclosedContainerStart: stack.find((item) => item.kind === 'container')?.start
  }
}

/**
 * The length of `text` up to the point where it stops leaving a container
 * directive open.
 *
 * Used for the balanced overview's preamble, which ends where the first outline
 * root begins. When that root is authored inside an admonition, the span before
 * it holds the `:::note` opener but not its closer — and the root's own
 * `selectionPrefix` reproduces that opener anyway, so keeping it would emit it
 * twice as well as leaving it unbalanced. Ending earlier does both jobs without
 * inventing syntax.
 */
const balancedLength = (text: string): number =>
  scanStructure(text).unclosedContainerStart ?? text.length

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
  const { starts, fenceCloser, containerClosers } = scanStructure(combined)

  const emittedLength = (index: number): number =>
    starts[index] +
    fenceCloser[index].length +
    TRUNCATION_MARKER.length +
    containerClosers[index].length

  let cut = -1
  let paragraphCut = -1
  for (let index = 1; index < starts.length; index += 1) {
    // Candidates start after the prefix: cutting into it would emit a partial
    // opener, and the prefix is mandatory syntax rather than content.
    if (starts[index] < prefix.length) continue
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
  // set still open is different, and `containerClosers` is that set. Emitting
  // both would close some of them twice.
  return {
    markdown: `${combined.slice(0, starts[chosen])}${fenceCloser[chosen]}${TRUNCATION_MARKER}${containerClosers[chosen]}`,
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
 */
const overviewSlices = (artifact: DocumentationCorpusDocumentArtifact): OverviewSlice[] => {
  const roots = artifact.outline.flatMap((item) => {
    const section = artifact.sections[item.sectionIndex]
    return section ? [section] : []
  })

  const slices: OverviewSlice[] = []
  const firstRootStart = roots[0]?.startOffset ?? artifact.markdown.length
  if (firstRootStart > 0) {
    const span = artifact.markdown.slice(0, firstRootStart)
    const preamble = span.slice(0, balancedLength(span))
    if (preamble.length > 0) {
      slices.push({
        heading: artifact.sections[0]?.title ?? '',
        anchor: undefined,
        source: preamble,
        prefix: '',
        suffix: '',
        documentOffset: 0,
        size: preamble.length
      })
    }
  }

  for (const section of roots) {
    slices.push({
      heading: section.title,
      anchor: section.anchor ?? undefined,
      source: artifact.markdown.slice(section.startOffset, section.endOffset),
      prefix: section.selectionPrefix,
      suffix: section.selectionSuffix,
      documentOffset: section.startOffset,
      size: section.characterCount
    })
  }
  return slices
}

const truncationOf = (
  sourceCharacterCount: number,
  sections: readonly DocumentationSelectionSection[],
  truncated: boolean,
  nextSectionAnchor: string | null
): DocumentationCorpusReadTruncation => {
  const returnedCharacterCount = sections.reduce((total, item) => total + item.markdown.length, 0)
  return {
    truncated,
    sourceCharacterCount,
    returnedCharacterCount,
    omittedCharacterCount: truncated
      ? Math.max(0, sourceCharacterCount - returnedCharacterCount)
      : 0,
    nextSectionAnchor: truncated ? nextSectionAnchor : null
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
      sections,
      slice.truncated,
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
  const slice = boundedSlice({
    source: artifact.markdown.slice(section.startOffset, section.endOffset),
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
      sections,
      slice.truncated,
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
  const slices = overviewSlices(artifact)
  const allocation = allocateBudget(
    slices.map((slice) => slice.size),
    budget
  )

  let firstTruncatedAnchor: string | null = null
  let anyTruncated = false
  const sections = slices.map((slice, index) => {
    const bounded = boundedSlice({
      source: slice.source,
      prefix: slice.prefix,
      suffix: slice.suffix,
      budget: allocation[index]
    })
    if (bounded.truncated) {
      anyTruncated = true
      if (firstTruncatedAnchor === null) firstTruncatedAnchor = slice.anchor ?? null
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
    // Derived rather than assumed, even though the caller only reaches here
    // because the document did not fit.
    truncation: truncationOf(artifact.markdown.length, sections, anyTruncated, firstTruncatedAnchor)
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
