/**
 * The shared semantic validator, and the property that makes it worth sharing:
 * the build and the browser reject the same corpus.
 *
 * These are the relationships selection reads as if they agreed with each other
 * — offsets, character counts, anchor uniqueness, and outline-to-section
 * references. None is expressible in a type, and none throws when violated: a
 * bad `sectionIndex` silently produces an overview of the wrong parts of a
 * document, which is the failure mode worth a hard error.
 */
import { describe, expect, it } from 'vitest'
import type { DocumentationCorpusDocumentArtifact } from '@tinytinkerer/app-browser/documentation-corpus'
import {
  documentationArtifactEntryProblem,
  documentationArtifactProblem
} from '../artifact-invariants'
import { normalizeDocumentation } from '../normalize'
import { CANONICAL } from '../../docs-tools/__tests__/site-artifact-fixture'

/** A real document, so "valid" means what the build actually emits. */
const valid = (): DocumentationCorpusDocumentArtifact => structuredClone(CANONICAL.artifact)

describe('documentationArtifactProblem', () => {
  it('accepts what the build produces for this site', () => {
    expect(documentationArtifactProblem(valid())).toBeUndefined()
  })

  it('accepts every authored document, not only the sampled one', () => {
    for (const source of ['# A\n\n## B\n\ntext\n', '# Only a title\n']) {
      const normalized = normalizeDocumentation(source, 'T', 'md')
      expect(
        documentationArtifactProblem({
          schemaVersion: 1,
          ref: 'synthetic',
          version: 'current',
          contentHash: 'c'.repeat(64),
          characterCount: normalized.markdown.length,
          markdown: normalized.markdown,
          outline: normalized.outline,
          sections: normalized.sections
        })
      ).toBeUndefined()
    }
  })

  it('rejects a section whose declared position is not its position', () => {
    const artifact = valid()
    artifact.sections[1].index = 99
    expect(documentationArtifactProblem(artifact)).toMatch(/declares index 99/)
  })

  it('rejects offsets that run past the Markdown', () => {
    const artifact = valid()
    artifact.sections[1].endOffset = Number.MAX_SAFE_INTEGER
    expect(documentationArtifactProblem(artifact)).toMatch(/invalid offsets/)
  })

  it('rejects a characterCount that disagrees with the offsets', () => {
    const artifact = valid()
    // What every allocation decision is budgeted against, so a wrong value makes
    // an overview silently mis-sized without any slice ever throwing.
    artifact.sections[1].characterCount += 500
    expect(documentationArtifactProblem(artifact)).toMatch(/declares characterCount/)
  })

  it('rejects a duplicated anchor', () => {
    const artifact = valid()
    const anchor = artifact.sections.find((section) => section.anchor !== null)?.anchor
    const other = artifact.sections.find(
      (section) => section.anchor !== null && section.anchor !== anchor
    )
    if (!anchor || !other) throw new Error('fixture needs two anchored sections')
    other.anchor = anchor

    expect(documentationArtifactProblem(artifact)).toMatch(/more than one section anchored/)
  })

  it('rejects an outline entry pointing at a section that does not exist', () => {
    const artifact = valid()
    artifact.outline[0].sectionIndex = 9_999
    expect(documentationArtifactProblem(artifact)).toMatch(/does not exist/)
  })

  it('rejects an outline entry pointing at the wrong section', () => {
    const artifact = valid()
    // The failure that matters most to a balanced overview: the read succeeds
    // and returns text from somewhere else in the document.
    artifact.outline[0].sectionIndex = 0
    expect(documentationArtifactProblem(artifact)).toMatch(/which is anchored/)
  })

  it('rejects an outline entry nested below a valid one', () => {
    const artifact = valid()
    const nested = artifact.outline.find((item) => item.children.length > 0)
    if (!nested) throw new Error('fixture needs a nested outline entry')
    nested.children[0].sectionIndex = 9_999

    expect(documentationArtifactProblem(artifact)).toMatch(/does not exist/)
  })

  it('rejects a characterCount that disagrees with the Markdown', () => {
    const artifact = valid()
    artifact.characterCount += 1
    expect(documentationArtifactProblem(artifact)).toMatch(/but its Markdown is/)
  })
})

describe('documentationArtifactEntryProblem', () => {
  const entry = CANONICAL.entry

  it('accepts the manifest entry the build wrote beside it', () => {
    expect(documentationArtifactEntryProblem(entry, valid())).toBeUndefined()
  })

  it('classifies a different document as an identity problem', () => {
    const artifact = valid()
    artifact.ref = 'somewhere/else'
    // Not a content-integrity failure: the bytes are fine, they are simply
    // another document's. Callers map the two kinds to different codes.
    expect(documentationArtifactEntryProblem(entry, artifact)?.kind).toBe('identity')
  })

  it('classifies a changed content hash as a content problem', () => {
    const artifact = valid()
    artifact.contentHash = 'f'.repeat(64)
    expect(documentationArtifactEntryProblem(entry, artifact)?.kind).toBe('content')
  })

  it('catches a manifest summary that no longer describes the artifact', () => {
    expect(
      documentationArtifactEntryProblem({ ...entry, sectionCount: entry.sectionCount + 1 }, valid())
    ).toMatchObject({ kind: 'content' })
    expect(
      documentationArtifactEntryProblem(
        { ...entry, characterCount: entry.characterCount + 1 },
        valid()
      )
    ).toMatchObject({ kind: 'content' })
  })
})
