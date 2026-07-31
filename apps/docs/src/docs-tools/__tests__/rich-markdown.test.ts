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

  it('gives every emitted opener its own closer, in the slice that emitted it', () => {
    const selection = selectDocument(artifact, 900)

    // The preamble ends inside the admonition, so it opens a container the
    // section slice opens again through its own `selectionPrefix`. Repeating a
    // wrapper across slices is the corpus' own design; what must never happen is
    // an opener without a closer, which is checked per slice rather than by
    // counting openers across the response.
    for (const section of selection.sections) {
      expect(containerBalance(section.markdown)).toBe(0)
    }
  })
})

/**
 * Content authored between a container's opener and the first heading inside
 * it.
 *
 * An earlier revision ended the overview's preamble at the point the container
 * opened, which deleted this prose outright — and, because truncation was
 * derived from whether the surviving slices needed a local cut, reported
 * `truncated: false` with `omittedCharacterCount: 0` while doing it.
 */
describe('container prologue', () => {
  const PROLOGUE = lines(40, (index) => `Prologue sentence ${index} inside the note.`)
  const artifact = artifactOf(
    [
      '# Doc',
      '',
      'Intro prose before the note.',
      '',
      ':::note[Wrapped]',
      '',
      PROLOGUE,
      '',
      '## First addressable heading',
      '',
      lines(40, (index) => `Body line ${index}.`),
      '',
      ':::',
      ''
    ].join('\n')
  )

  it('is a document whose prologue no outline entry covers', () => {
    const firstRoot = artifact.sections[artifact.outline[0].sectionIndex]
    expect(artifact.markdown.slice(0, firstRoot.startOffset)).toContain('Prologue sentence 39')
  })

  it('returns the prologue instead of discarding it', () => {
    // Just under the whole document, so the balanced overview runs rather than
    // `full`, and every slice still receives close to its full size.
    const selection = selectDocument(artifact, artifact.markdown.length - 100)
    const returned = selection.sections.map((section) => section.markdown).join('\n')

    expect(selection.selection).toBe('balanced_overview')
    // The earlier revision returned *none* of it: the preamble ended where the
    // container opened, so every one of these lines was clipped away.
    const present = PROLOGUE.split('\n').filter((line) => returned.includes(line))
    expect(present.length).toBeGreaterThan(35)
    for (const section of selection.sections) {
      expect(containerBalance(section.markdown)).toBe(0)
    }
  })

  it('reports what it left out at every budget, and never claims to have left out nothing', () => {
    for (let budget = 80; budget <= 3_000; budget += 20) {
      const selection = selectDocument(artifact, budget)
      const returned = selection.sections.reduce(
        (total, section) => total + section.markdown.length,
        0
      )
      const { truncated, omittedCharacterCount, sourceCharacterCount } = selection.truncation

      expect(sourceCharacterCount).toBe(artifact.markdown.length)
      // The invariant the accounting is now derived from, rather than a flag set
      // beside it: reported truncation and reported omission cannot disagree.
      expect(truncated).toBe(omittedCharacterCount > 0)
      if (returned < artifact.markdown.length) expect(truncated).toBe(true)
    }
  })

  it('accounts for every authored line: present in the response, or counted as omitted', () => {
    const authored = artifact.markdown.split('\n').filter((line) => line.trim().length > 0)

    for (let budget = 80; budget <= 3_000; budget += 20) {
      const selection = selectDocument(artifact, budget)
      const returned = selection.sections.map((section) => section.markdown).join('\n')
      const absent = authored.filter((line) => !returned.includes(line))
      const absentCharacters = absent.reduce((total, line) => total + line.length, 0)

      // Derived from the response text rather than from the implementation, so
      // it fails for content that is dropped by any means — clipped away before
      // allocation, or cut inside a slice.
      expect(selection.truncation.omittedCharacterCount).toBeGreaterThanOrEqual(absentCharacters)
      if (absent.length > 0) expect(selection.truncation.truncated).toBe(true)
    }
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

  it('never returns a header row without its delimiter, at any budget', () => {
    // A generous budget hides this: it only happens where the budget reaches the
    // header line and stops before the delimiter. Measured at budgets 42-55, the
    // response was `| Symptom | Cause | Fix |` alone, which GFM renders as a
    // paragraph — the promised table silently becoming prose.
    const isDelimiter = (line: string): boolean =>
      line.includes('|') && line.includes('-') && /^[\s|:-]+$/.test(line)

    for (let budget = 1; budget <= 600; budget += 1) {
      const markdown = selectSection(artifact, artifact.sections[1], budget).sections[0]?.markdown
      const rows = (markdown ?? '').split('\n')
      const header = rows.findIndex((line) => line.startsWith('| Symptom |'))
      if (header < 0) continue
      expect(isDelimiter(rows[header + 1] ?? '')).toBe(true)
    }
  })
})

/**
 * Container directives and fences the normalizer accepts but that no document on
 * this site authors yet.
 *
 * The scanner is a line scanner, so what it recognises is a contract in its own
 * right: a construct it fails to recognise is one it fails to close. A directive
 * inside a blockquote is recorded by the corpus with a `> :::note[...]`
 * `selectionPrefix`, and an earlier revision — which allowed only three leading
 * spaces before a marker — emitted that opener and no closer at all.
 */
describe('containers the corpus accepts but this site does not yet author', () => {
  const quoted = artifactOf(
    [
      '# Quoted',
      '',
      'Lead prose.',
      '',
      '> :::note[Quoted]',
      '>',
      '> ## Heading inside a quoted note',
      '>',
      lines(120, (index) => `> Quoted body line ${index}.`),
      '>',
      '> :::',
      ''
    ].join('\n')
  )

  const quotedSection = quoted.sections[quoted.outline[0].sectionIndex]

  it('records the blockquote prefix on the wrapper, which is what must be closed', () => {
    expect(quotedSection.selectionPrefix).toBe('> :::note[Quoted]\n\n')
  })

  it('closes a blockquote-nested directive with a blockquote-nested closer', () => {
    for (let budget = 40; budget <= 800; budget += 1) {
      const markdown = selectSection(quoted, quotedSection, budget).sections[0]?.markdown ?? ''
      if (markdown.length === 0) continue
      const openers = (markdown.match(/^[ \t>]*:{3,}[A-Za-z]/gm) ?? []).length
      const closers = (markdown.match(/^[ \t>]*:{3,}[ \t]*$/gm) ?? []).length
      expect(closers).toBe(openers)
      if (openers > 0) expect(markdown).toMatch(/^>[ \t]*:{3,}[ \t]*$/m)
      expect(markdown.length).toBeLessThanOrEqual(budget)
    }
  })

  const listed = artifactOf(
    [
      '# Listed',
      '',
      'Lead prose.',
      '',
      '## Steps',
      '',
      '1. First step:',
      '',
      '   - Nested item:',
      '',
      // Six spaces: past the three CommonMark allows a construct at the *root*,
      // which is where an earlier revision stopped looking for openers.
      '      :::tip[Indented]',
      '',
      lines(80, (index) => `      Tip body line ${index}.`),
      '',
      '      :::',
      ''
    ].join('\n')
  )

  it('closes a list-indented directive at the indentation it was opened at', () => {
    const section = listed.sections[listed.outline[0].sectionIndex]
    for (let budget = 40; budget <= 800; budget += 1) {
      const markdown = selectSection(listed, section, budget).sections[0]?.markdown ?? ''
      if (markdown.length === 0) continue
      const openers = (markdown.match(/^[ \t]*:{3,}[A-Za-z]/gm) ?? []).length
      const closers = (markdown.match(/^[ \t]*:{3,}[ \t]*$/gm) ?? []).length
      expect(closers).toBe(openers)
      expect(markdown.length).toBeLessThanOrEqual(budget)
    }
  })

  it('does not mistake an indented fence inside a fence for the fence closer', () => {
    // A document that documents Markdown. The inner indented ``` is content;
    // treating it as the closer would leave the real code block unterminated.
    const nested = artifactOf(
      [
        '# Fences',
        '',
        'Lead prose.',
        '',
        '## Showing a fence',
        '',
        '````md',
        '    ```ts',
        lines(60, (index) => `    const value${index} = ${index}`),
        '    ```',
        '````',
        ''
      ].join('\n')
    )

    const section = nested.sections[nested.outline[0].sectionIndex]
    for (let budget = 40; budget <= 600; budget += 1) {
      const markdown = selectSection(nested, section, budget).sections[0]?.markdown ?? ''
      if (!markdown.includes('````')) continue
      expect((markdown.match(/^`{4,}/gm) ?? []).length % 2).toBe(0)
      expect(markdown.length).toBeLessThanOrEqual(budget)
    }
  })
})
