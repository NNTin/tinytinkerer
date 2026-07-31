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
  visit: (item: DocumentationCorpusOutlineItem) => void
): void => {
  for (const item of items) {
    visit(item)
    walkOutline(item.children, visit)
  }
}

/**
 * Checks every relationship a consumer relies on: section positions, offsets,
 * character counts, anchor uniqueness, and outline-to-section referential
 * integrity.
 *
 * The outline check is the one that matters most to #477: a balanced overview
 * resolves `outline[i].sectionIndex` into `sections`, so an outline entry
 * pointing at a missing or mismatched section would silently produce an
 * overview of the wrong parts of the document.
 */
export const documentationArtifactProblem = (
  artifact: DocumentationCorpusDocumentArtifact
): string | undefined => {
  if (artifact.characterCount !== artifact.markdown.length) {
    return `declares characterCount ${artifact.characterCount}, but its Markdown is ${artifact.markdown.length} characters`
  }

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

  let outlineProblem: string | undefined
  walkOutline(artifact.outline, (item) => {
    if (outlineProblem) return
    const section = artifact.sections[item.sectionIndex]
    if (!section) {
      outlineProblem = `outline entry "${item.anchor}" points at section ${item.sectionIndex}, which does not exist`
      return
    }
    if (section.anchor !== item.anchor) {
      outlineProblem = `outline entry "${item.anchor}" points at section ${item.sectionIndex}, which is anchored "${String(section.anchor)}"`
    }
  })
  return outlineProblem
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
