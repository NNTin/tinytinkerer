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

/** Marks where text was cut. Kept short: it is spent from the same budget. */
const TRUNCATION_MARKER = '\n\n…[truncated]\n'

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

/** The independently valid Markdown for one corpus section. */
const sectionMarkdown = (
  artifact: DocumentationCorpusDocumentArtifact,
  section: DocumentationCorpusSection
): string =>
  `${section.selectionPrefix}${artifact.markdown.slice(section.startOffset, section.endOffset)}${section.selectionSuffix}`

/**
 * Line starts in `text`, paired with the fence marker open *at* each one.
 *
 * Cutting text at an arbitrary offset can land inside a fenced code block, and
 * the result would not be valid Markdown — the rest of the response would render
 * as code. Tracking the fence per line start is what lets `truncateMarkdown`
 * close the block it cut into instead of throwing the cut away.
 */
const lineStates = (text: string): { starts: number[]; openFence: (string | undefined)[] } => {
  const starts: number[] = []
  const openFence: (string | undefined)[] = []
  let offset = 0
  let open: string | undefined
  for (const line of text.split('\n')) {
    starts.push(offset)
    openFence.push(open)
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (match) {
      const marker = match[1]
      if (open === undefined) {
        open = marker
      } else if (
        marker[0] === open[0] &&
        marker.length >= open.length &&
        /^\s{0,3}[`~]+\s*$/.test(line)
      ) {
        open = undefined
      }
    }
    offset += line.length + 1
  }
  return { starts, openFence }
}

/**
 * Bounds `text` to `budget` characters at a Markdown-safe boundary.
 *
 * The cut is always a line start — never mid-line, so no list marker, table row,
 * or link is ever severed — and when it falls inside a fenced block the fence is
 * closed rather than abandoned.
 *
 * That last rule is not a detail. The obvious alternative, retreating to before
 * the block's opening, was measured on the real corpus and is far worse: it
 * drops budget utilisation from ~97% to 71%, and reduces a section whose code
 * block starts right after its heading to the heading alone —
 * `self-hosting/litellm-setup.md`'s Troubleshooting came back as 20 characters.
 * Closing the fence keeps the returned Markdown independently valid while
 * spending the budget on content. Truncated GFM tables need nothing special:
 * a header, its separator, and whole rows are already a valid table.
 */
export const truncateMarkdown = (text: string, budget: number): string => {
  if (text.length <= budget) return text
  if (budget <= TRUNCATION_MARKER.length) return ''

  const limit = budget - TRUNCATION_MARKER.length
  const { starts, openFence } = lineStates(text)

  // The last line start at or below the limit, preferring one that follows a
  // blank line so a cut lands between paragraphs where it can.
  let cutIndex = -1
  let paragraphIndex = -1
  for (let index = 1; index < starts.length; index += 1) {
    const start = starts[index]
    if (start > limit) break
    cutIndex = index
    if (/\n[ \t]*\n$/.test(text.slice(Math.max(0, start - 2), start))) paragraphIndex = index
  }
  if (cutIndex < 0) return ''

  // A paragraph boundary reads better, but only if reaching it costs little.
  // Measured on the real corpus: allowing an arbitrary retreat spends about a
  // fifth of the budget on whitespace alignment (16,112 returned characters
  // instead of 19,299 for the oversized document), and a section that opens
  // with one long code block has no paragraph break inside the budget at all.
  // The `…[truncated]` marker already tells the reader the text was cut, so a
  // mid-paragraph cut is honest rather than confusing.
  const paragraphRetreatAllowance = Math.floor(limit / 8)
  const chosen =
    paragraphIndex > 0 && starts[cutIndex] - starts[paragraphIndex] <= paragraphRetreatAllowance
      ? paragraphIndex
      : cutIndex

  const cut = starts[chosen]
  const fence = openFence[chosen]
  const closing = fence === undefined ? '' : `${fence}\n`
  return `${text.slice(0, cut)}${closing}${TRUNCATION_MARKER}`
}

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
      const size = sizes[index]
      allocation[index] = size
      remaining -= size
    }
    open = open.filter((index) => sizes[index] > share)
  }

  return allocation
}

type OverviewSlice = {
  heading: string
  anchor: string | undefined
  start: number
  end: number
}

/**
 * The units a balanced overview is built from: the document preamble, then one
 * slice per top-level outline entry.
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
    slices.push({
      heading: artifact.sections[0]?.title ?? '',
      anchor: undefined,
      start: 0,
      end: firstRootStart
    })
  }
  for (const section of roots) {
    slices.push({
      heading: section.title,
      anchor: section.anchor ?? undefined,
      start: section.startOffset,
      end: section.endOffset
    })
  }
  return slices
}

const truncationOf = (
  sourceCharacterCount: number,
  sections: readonly DocumentationSelectionSection[],
  nextSectionAnchor: string | null
): DocumentationCorpusReadTruncation => {
  const returnedCharacterCount = sections.reduce((total, item) => total + item.markdown.length, 0)
  const omittedCharacterCount = Math.max(0, sourceCharacterCount - returnedCharacterCount)
  return {
    truncated: omittedCharacterCount > 0,
    sourceCharacterCount,
    returnedCharacterCount,
    omittedCharacterCount,
    nextSectionAnchor: omittedCharacterCount > 0 ? nextSectionAnchor : null
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

/** The whole document, when it fits. */
const selectFull = (
  artifact: DocumentationCorpusDocumentArtifact,
  budget: number
): DocumentationSelection => {
  const markdown = truncateMarkdown(artifact.markdown, budget)
  const heading = artifact.sections[0]?.title
  const sections: DocumentationSelectionSection[] = [{ ...(heading ? { heading } : {}), markdown }]
  return {
    selection: 'full',
    sections,
    truncation: truncationOf(
      artifact.markdown.length,
      sections,
      nextAnchorAfter(artifact, markdown.length)
    )
  }
}

/** One named section, truncated at a safe boundary if it alone overruns. */
export const selectSection = (
  artifact: DocumentationCorpusDocumentArtifact,
  section: DocumentationCorpusSection,
  budget: number
): DocumentationSelection => {
  const source = sectionMarkdown(artifact, section)
  const markdown = truncateMarkdown(source, budget)
  const sections: DocumentationSelectionSection[] = [
    {
      heading: section.title,
      ...(section.anchor ? { anchor: section.anchor } : {}),
      markdown
    }
  ]
  return {
    selection: 'section',
    sections,
    truncation: truncationOf(
      source.length,
      sections,
      // Where the returned text stopped inside the document, so the suggestion
      // is a section the reader has not already been shown.
      nextAnchorAfter(artifact, section.startOffset + markdown.length)
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
    slices.map((slice) => slice.end - slice.start),
    budget
  )

  let firstTruncatedAnchor: string | null = null
  const sections = slices.map((slice, index) => {
    const source = artifact.markdown.slice(slice.start, slice.end)
    const markdown = truncateMarkdown(source, allocation[index])
    if (markdown.length < source.length && firstTruncatedAnchor === null) {
      firstTruncatedAnchor = slice.anchor ?? null
    }
    return {
      ...(slice.heading ? { heading: slice.heading } : {}),
      ...(slice.anchor ? { anchor: slice.anchor } : {}),
      markdown
    }
  })

  return {
    selection: 'balanced_overview',
    sections,
    truncation: truncationOf(artifact.markdown.length, sections, firstTruncatedAnchor)
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
