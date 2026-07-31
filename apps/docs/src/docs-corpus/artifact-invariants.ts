/**
 * The single authoritative answer to "is this document artifact internally
 * consistent?", shared by the build and the browser.
 *
 * There were briefly three interpretations of artifact validity: the TypeScript
 * contract (shapes only, erased at runtime), `validate-corpus.ts` (the build's
 * semantic invariants), and the runtime store's own guard. The two runtime-
 * checkable ones are unified here, because they check the same thing for the
 * same reason and drifting apart is exactly the debt that ends up costing a
 * later consumer: selection reads `startOffset`/`endOffset`,
 * `selectionPrefix`/`selectionSuffix` and the outline's `sectionIndex` as if
 * they agreed with each other, and none of those relationships is expressible
 * in a type.
 *
 * Deliberately browser-safe — no `node:crypto`, no filesystem — so the runtime
 * artifact store can use it. Hashing and byte-level checks stay in
 * `validate-corpus.ts`, which is the build's concern.
 *
 * Every function returns a message rather than throwing, so each caller can
 * fail the build or return a typed failure as suits it.
 */
import type {
  DocumentationCorpusDocumentArtifact,
  DocumentationCorpusOutlineItem,
  DocumentationCorpusSection
} from '@tinytinkerer/app-browser/documentation-corpus'

const sectionProblem = (
  markdown: string,
  section: DocumentationCorpusSection,
  index: number
): string | undefined => {
  if (section.index !== index) {
    return `section at position ${index} declares index ${section.index}`
  }
  if (
    section.startOffset < 0 ||
    section.startOffset > section.contentStartOffset ||
    section.contentStartOffset > section.endOffset ||
    section.endOffset > markdown.length
  ) {
    return `section ${section.index} has invalid offsets`
  }
  // What a bounded reader budgets against. A count that disagrees with the
  // offsets would make every allocation decision wrong without any slice ever
  // throwing.
  const expected =
    section.selectionPrefix.length +
    section.endOffset -
    section.startOffset +
    section.selectionSuffix.length
  if (section.characterCount !== expected) {
    return `section ${section.index} declares characterCount ${section.characterCount}, but its offsets and selection wrappers give ${expected}`
  }
  return undefined
}

const walkOutline = (
  items: readonly DocumentationCorpusOutlineItem[],
  visit: (item: DocumentationCorpusOutlineItem, parent?: DocumentationCorpusOutlineItem) => void,
  parent?: DocumentationCorpusOutlineItem
): void => {
  for (const item of items) {
    visit(item, parent)
    walkOutline(item.children, visit, item)
  }
}

/**
 * The synthetic whole-document section every artifact begins with.
 *
 * It is not an authored heading: `createSections` prepends it so an unanchored
 * read has something to name, and consumers rely on that — `selectFull` takes
 * its `title` as the document heading, and the balanced overview takes it as
 * the preamble's. An artifact whose section 0 were a real heading would give
 * both the wrong name and, worse, hand the overview a span that does not cover
 * the document.
 */
const wholeDocumentSectionProblem = (
  artifact: DocumentationCorpusDocumentArtifact
): string | undefined => {
  const section = artifact.sections[0]
  if (!section) return 'has no sections; every artifact carries a whole-document section at index 0'
  if (
    section.anchor !== null ||
    section.depth !== 0 ||
    section.parentAnchor !== null ||
    section.startOffset !== 0 ||
    section.contentStartOffset !== 0 ||
    section.endOffset !== artifact.markdown.length ||
    section.selectionPrefix !== '' ||
    section.selectionSuffix !== ''
  ) {
    return 'section 0 is not the whole-document section: it must be unanchored, at depth 0, span the entire Markdown, and carry no selection wrappers'
  }
  return undefined
}

/**
 * The outline and the addressable sections must describe each other exactly.
 *
 * A one-way check — "every outline entry points at a matching section" — is
 * satisfied by an artifact with **no outline at all**, and that is not a
 * harmless gap: the balanced overview is built from outline roots, so an empty
 * outline degrades it to a single unanchored slice from the start of the
 * document. That is precisely the "first N characters" behaviour #477 forbids,
 * arrived at silently, with every other check passing.
 *
 * So the relationship is validated as a bijection, together with the ordering
 * and nesting the flattened outline promises a reader.
 */
const outlineProblem = (artifact: DocumentationCorpusDocumentArtifact): string | undefined => {
  const addressable = artifact.sections.filter((section) => section.anchor !== null)
  const seen = new Map<number, DocumentationCorpusOutlineItem>()
  let problem: string | undefined
  let previousIndex = -1

  walkOutline(artifact.outline, (item, parent) => {
    if (problem) return
    const section = artifact.sections[item.sectionIndex]
    if (!section) {
      problem = `outline entry "${item.anchor}" points at section ${item.sectionIndex}, which does not exist`
      return
    }
    if (section.anchor !== item.anchor) {
      problem = `outline entry "${item.anchor}" points at section ${item.sectionIndex}, which is anchored "${String(section.anchor)}"`
      return
    }
    if (seen.has(item.sectionIndex)) {
      problem = `outline lists section ${item.sectionIndex} ("${item.anchor}") more than once`
      return
    }
    seen.set(item.sectionIndex, item)
    // Document order, which is what makes a flattened outline readable as the
    // page's structure rather than as an arbitrary list.
    if (item.sectionIndex <= previousIndex) {
      problem = `outline entry "${item.anchor}" is out of document order (section ${item.sectionIndex} after ${previousIndex})`
      return
    }
    previousIndex = item.sectionIndex
    if (item.depth !== section.depth || item.title !== section.title) {
      problem = `outline entry "${item.anchor}" disagrees with section ${item.sectionIndex} about its heading`
      return
    }
    if (parent) {
      if (item.depth <= parent.depth) {
        problem = `outline entry "${item.anchor}" is nested under "${parent.anchor}" but is not deeper than it`
        return
      }
      if (section.parentAnchor !== parent.anchor) {
        problem = `outline nests "${item.anchor}" under "${parent.anchor}", but its section records parent "${String(section.parentAnchor)}"`
      }
      return
    }
    if (section.parentAnchor !== null) {
      problem = `outline lists "${item.anchor}" as a root, but its section records parent "${String(section.parentAnchor)}"`
    }
  })
  if (problem) return problem

  const missing = addressable.find((section) => !seen.has(section.index))
  if (missing) {
    return `section ${missing.index} is anchored "${String(missing.anchor)}" but appears nowhere in the outline`
  }
  return undefined
}

/**
 * Checks every relationship a consumer relies on: the whole-document section,
 * section positions, offsets, character counts, anchor uniqueness, and the
 * bijection between the outline and the addressable sections.
 *
 * The outline check is the one that matters most to #477: a balanced overview
 * resolves `outline[i].sectionIndex` into `sections`, so an outline entry
 * pointing at a missing or mismatched section would silently produce an
 * overview of the wrong parts of the document — and an outline missing entries
 * would silently produce an overview of only part of it.
 */
export const documentationArtifactProblem = (
  artifact: DocumentationCorpusDocumentArtifact
): string | undefined => {
  if (artifact.characterCount !== artifact.markdown.length) {
    return `declares characterCount ${artifact.characterCount}, but its Markdown is ${artifact.markdown.length} characters`
  }

  const wholeDocument = wholeDocumentSectionProblem(artifact)
  if (wholeDocument) return wholeDocument

  const anchors = new Set<string>()
  for (const [index, section] of artifact.sections.entries()) {
    const problem = sectionProblem(artifact.markdown, section, index)
    if (problem) return problem
    if (section.anchor === null) continue
    if (anchors.has(section.anchor)) {
      return `has more than one section anchored "${section.anchor}"`
    }
    anchors.add(section.anchor)
  }

  return outlineProblem(artifact)
}

/**
 * How a manifest/artifact disagreement should be reported. An artifact that is
 * *another document* is an identity problem, not a content-integrity one, and a
 * caller has to be able to tell them apart without re-deriving the distinction
 * from which fields happen to differ.
 */
export type DocumentationArtifactEntryProblem = {
  kind: 'identity' | 'content'
  message: string
}

/**
 * The manifest's own summary of a document, checked against the artifact it
 * points at. Separate from the artifact's internal consistency because only a
 * caller holding both can check it — and because a mismatch means the two were
 * published by different builds, not that either is malformed.
 */
export const documentationArtifactEntryProblem = (
  entry: {
    ref: string
    version: string
    contentHash: string
    characterCount: number
    sectionCount: number
  },
  artifact: DocumentationCorpusDocumentArtifact
): DocumentationArtifactEntryProblem | undefined => {
  if (artifact.ref !== entry.ref || artifact.version !== entry.version) {
    return {
      kind: 'identity',
      message: `identifies itself as "${artifact.version}/${artifact.ref}", but the manifest requested "${entry.version}/${entry.ref}"`
    }
  }
  if (artifact.contentHash !== entry.contentHash) {
    return {
      kind: 'content',
      message: `reports content hash "${artifact.contentHash}", but the manifest records "${entry.contentHash}"`
    }
  }
  if (artifact.characterCount !== entry.characterCount) {
    return {
      kind: 'content',
      message: `is ${artifact.characterCount} characters, but the manifest records ${entry.characterCount}`
    }
  }
  if (artifact.sections.length !== entry.sectionCount) {
    return {
      kind: 'content',
      message: `has ${artifact.sections.length} sections, but the manifest records ${entry.sectionCount}`
    }
  }
  return undefined
}
