/**
 * Bounded selection over the rich Markdown #474 deliberately preserves.
 *
 * Admonitions are not exotic input here: the corpus records `selectionPrefix`
 * and `selectionSuffix` precisely so a section authored inside one can be
 * returned as valid Markdown, and #481 asks for regression coverage of it. An
 * earlier revision truncated `prefix + slice + suffix` as one opaque string, so
 * an oversized admonition-backed section came back opening `:::note` and never
 * closing it — and the balanced overview ignored the wrapper fields entirely.
 *
 * These documents are synthetic, and deliberately so: this site authors no
 * oversized admonition, and the point is to cover the branch it does not
 * exercise. Everything else in this directory resolves against the real corpus.
 */
import { describe, expect, it } from 'vitest'
import { normalizeDocumentation } from '../../docs-corpus/normalize'
import { boundedSlice, selectDocument, selectSection } from '../selection'

const lines = (count: number, text: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => text(index)).join('\n')

/** Balanced when every opener has a closer — the property truncation must keep. */
const containerBalance = (markdown: string): number =>
  markdown
    .split('\n')
    .reduce(
      (depth, line) =>
        /^\s{0,3}:{3,}[A-Za-z]/.test(line)
          ? depth + 1
          : /^\s{0,3}:{3,}\s*$/.test(line)
            ? depth - 1
            : depth,
      0
    )

const fenceBalance = (markdown: string): number =>
  markdown.split('\n').filter((line) => /^\s{0,3}(`{3,}|~{3,})/.test(line)).length % 2

const ADMONITION_DOC = [
  '# Doc',
  '',
  'Intro prose that lives before any addressable heading.',
  '',
  ':::note[Wrapped]',
  '',
  '## Oversized heading inside a note',
  '',
  lines(200, (index) => `Line ${index} of admonition body text.`),
  '',
  ':::',
  ''
].join('\n')

const artifactOf = (source: string) => {
  const normalized = normalizeDocumentation(source, 'Doc', 'md')
  return {
    schemaVersion: 1 as const,
    ref: 'synthetic/doc',
    version: 'current',
    contentHash: 'c'.repeat(64),
    characterCount: normalized.markdown.length,
    markdown: normalized.markdown,
    outline: normalized.outline,
    sections: normalized.sections
  }
}

describe('sections authored inside an admonition', () => {
  const artifact = artifactOf(ADMONITION_DOC)
  const target = artifact.sections[artifact.outline[0]?.sectionIndex ?? 0]

  it('is the case the corpus records wrapper fields for', () => {
    expect(target?.selectionPrefix).toContain(':::note')
  })

  it('returns a truncated anchored section with its container closed', () => {
    const selection = selectSection(artifact, target, 500)
    const markdown = selection.sections[0]?.markdown ?? ''

    expect(markdown.startsWith(':::note')).toBe(true)
    expect(containerBalance(markdown)).toBe(0)
    expect(markdown.trimEnd().endsWith(':::')).toBe(true)
    expect(markdown.length).toBeLessThanOrEqual(500)
  })

  it('returns a truncated whole document with its container closed', () => {
    const selection = selectDocument(artifact, 400)
    for (const section of selection.sections) {
      expect(containerBalance(section.markdown)).toBe(0)
      expect(fenceBalance(section.markdown)).toBe(0)
    }
  })

  it('gives every balanced-overview slice its own wrapper, balanced', () => {
    const selection = selectDocument(artifact, 900)
    expect(selection.selection).toBe('balanced_overview')

    const wrapped = selection.sections.find((section) => section.anchor !== undefined)
    expect(wrapped?.markdown.startsWith(':::note')).toBe(true)
    for (const section of selection.sections) {
      expect(containerBalance(section.markdown)).toBe(0)
    }
  })

  it('does not emit the container opener twice across preamble and section', () => {
    const selection = selectDocument(artifact, 900)
    const openers = selection.sections
      .map((section) => (section.markdown.match(/^\s{0,3}:{3,}[A-Za-z]/gm) ?? []).length)
      .reduce((total, count) => total + count, 0)

    // The preamble runs up to the first outline root, which here sits inside the
    // admonition — so the raw span before it holds an opener the section's own
    // `selectionPrefix` reproduces. It must appear once, not twice.
    expect(openers).toBe(1)
  })
})

describe('nested containers and fences', () => {
  const artifact = artifactOf(
    [
      '# Nested',
      '',
      'Lead prose.',
      '',
      '## Section with a fence inside an admonition',
      '',
      ':::warning[Careful]',
      '',
      '```ts',
      lines(120, (index) => `const value${index} = ${index}`),
      '```',
      '',
      ':::',
      ''
    ].join('\n')
  )

  it('closes the fence and the container, in that order', () => {
    const selection = selectSection(artifact, artifact.sections[1], 400)
    const markdown = selection.sections[0]?.markdown ?? ''

    expect(fenceBalance(markdown)).toBe(0)
    expect(containerBalance(markdown)).toBe(0)
    // The marker must not be inside the code block, or it renders as code.
    const fenceClose = markdown.lastIndexOf('```')
    expect(markdown.indexOf('…[truncated]')).toBeGreaterThan(fenceClose)
    expect(markdown.length).toBeLessThanOrEqual(400)
  })
})

describe('exact budget accounting', () => {
  const fenced = `\`\`\`ts\n${lines(50, (index) => `const a${index} = ${index}`)}\n\`\`\`\n`
  const wrapped = `:::note\n\n${lines(80, (index) => `Body line ${index}.`)}\n\n:::\n`

  it('never exceeds a budget, including the closing syntax it must add', () => {
    // An earlier revision reserved only the truncation marker and then appended
    // a fence closer, returning 25 characters for a budget of 21.
    for (const source of [fenced, wrapped]) {
      for (let budget = 1; budget <= 400; budget += 1) {
        expect(boundedSlice({ source, budget }).markdown.length).toBeLessThanOrEqual(budget)
      }
    }
  })

  it('never exceeds a budget that also has to carry a wrapper prefix and suffix', () => {
    const source = lines(200, (index) => `Body line ${index}.`)
    for (let budget = 1; budget <= 400; budget += 1) {
      const slice = boundedSlice({
        source,
        prefix: ':::note[Wrapped]\n\n',
        suffix: '\n:::\n',
        budget
      })
      expect(slice.markdown.length).toBeLessThanOrEqual(budget)
      if (slice.markdown.length > 0) expect(containerBalance(slice.markdown)).toBe(0)
    }
  })

  it('reports how much of the source it consumed, in source offsets', () => {
    const source = lines(200, (index) => `Body line ${index}.`)
    const slice = boundedSlice({ source, prefix: ':::note\n\n', suffix: '\n:::\n', budget: 500 })

    // Source offsets, not emitted characters: the caller uses this to locate
    // where the read stopped inside the document.
    expect(slice.consumedSourceChars).toBeLessThanOrEqual(source.length)
    expect(source.slice(0, slice.consumedSourceChars)).toBe(
      slice.markdown.slice(':::note\n\n'.length, ':::note\n\n'.length + slice.consumedSourceChars)
    )
  })

  it('returns nothing rather than unbalanced syntax when the budget cannot hold it', () => {
    expect(
      boundedSlice({ source: wrapped, prefix: ':::note\n', suffix: '\n:::\n', budget: 5 })
    ).toMatchObject({ markdown: '', truncated: true })
  })
})

describe('tables', () => {
  const artifact = artifactOf(
    [
      '# Tables',
      '',
      'Lead.',
      '',
      '## A long table',
      '',
      '| Symptom | Cause | Fix |',
      '| --- | --- | --- |',
      lines(80, (index) => `| Symptom ${index} | Cause ${index} | Fix ${index} |`),
      ''
    ].join('\n')
  )

  it('truncates at a row boundary, leaving a valid table', () => {
    const markdown = selectSection(artifact, artifact.sections[1], 400).sections[0]?.markdown ?? ''
    const rows = markdown.split('\n').filter((line) => line.startsWith('|'))

    expect(rows.length).toBeGreaterThan(2)
    for (const row of rows) expect(row.trimEnd().endsWith('|')).toBe(true)
    expect(markdown.length).toBeLessThanOrEqual(400)
  })
})
