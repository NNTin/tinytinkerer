import { describe, expect, it } from 'vitest'
import { parseMarkdownContent, parseMarkdownFragment } from '../src/parse-markdown-content.js'
import {
  createMarkdownContentSession,
  createMarkdownContentSessionWith,
  findStableBoundary
} from '../src/markdown-content-session.js'

// A tiny deterministic PRNG (mulberry32) so the "random" chunking is
// reproducible — a failing seed is always re-runnable.
const mulberry32 = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const chunkFixed = (source: string, size: number): string[] => {
  const chunks: string[] = []
  for (let i = 0; i < source.length; i += size) {
    chunks.push(source.slice(i, i + size))
  }
  return chunks
}

const chunkRandom = (source: string, seed: number): string[] => {
  const rand = mulberry32(seed)
  const chunks: string[] = []
  let i = 0
  while (i < source.length) {
    const size = 1 + Math.floor(rand() * 9)
    chunks.push(source.slice(i, i + size))
    i += size
  }
  return chunks
}

const SVG_A = '![alt a](data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>)'
// One SVG whose raw markup contains a literal blank line — the boundary scanner
// must never stabilize inside it.
const SVG_B = [
  '![alt b](data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg">',
  '',
  '<rect/></svg>)'
].join('\n')

const CORPUS: Record<string, string> = {
  paragraphs: ['First paragraph.', '', 'Second paragraph.', '', 'Third paragraph.'].join('\n'),
  headings: ['# Title', '', '## Sub', '', 'Body text here.'].join('\n'),
  inlineMarks: 'A line with *em*, **strong**, `code`, and a [link](https://example.com).',
  fencedWithBlanks: [
    'Intro',
    '',
    '```ts',
    'const a = 1',
    '',
    'const b = 2',
    '```',
    '',
    'Outro'
  ].join('\n'),
  tildeFence: ['~~~', 'plain fenced', '', 'still fenced', '~~~', '', 'After tilde.'].join('\n'),
  indentedCode: ['Intro', '', '    code line 1', '', '    code line 2', '', 'Outro'].join('\n'),
  looseList: ['- a', '', '- b', '', 'Trailing paragraph.'].join('\n'),
  nestedList: ['- top', '  - nested one', '  - nested two', '', 'Done.'].join('\n'),
  blockquote: ['> quoted **line**', '> second quoted line', '', 'Out of quote.'].join('\n'),
  table: ['| a | b |', '| :--- | ---: |', '| 1 | 2 |', '| 3 | 4 |', '', 'After table.'].join('\n'),
  thematicBreaks: ['Before.', '', '---', '', 'After.'].join('\n'),
  rawSvgTwoBlocks: ['Here is one:', '', SVG_A, '', 'And another:', '', SVG_B, '', 'The end.'].join(
    '\n'
  ),
  htmlComment: [
    'Before comment.',
    '',
    '<!-- a comment',
    '',
    'still commented -->',
    '',
    'After.'
  ].join('\n'),
  preTag: 'A paragraph mentioning <pre>fixed</pre> inline text.',
  mixed: [
    '# Report',
    '',
    'Summary with `code` and **bold**.',
    '',
    '```js',
    'x()',
    '',
    'y()',
    '```',
    '',
    '- one',
    '',
    '- two',
    '',
    '| h1 | h2 |',
    '| --- | --- |',
    '| a | b |',
    '',
    '> note',
    '',
    'Closing paragraph.'
  ].join('\n')
}

describe('createMarkdownContentSession — incremental equivalence (issue #338)', () => {
  const chunkings: { label: string; make: (s: string) => string[] }[] = [
    { label: 'size-1', make: (s) => chunkFixed(s, 1) },
    { label: 'size-3', make: (s) => chunkFixed(s, 3) },
    { label: 'size-7', make: (s) => chunkFixed(s, 7) },
    { label: 'size-17', make: (s) => chunkFixed(s, 17) },
    { label: 'random', make: (s) => chunkRandom(s, 1337) }
  ]

  for (const [name, source] of Object.entries(CORPUS)) {
    for (const chunking of chunkings) {
      it(`streams "${name}" in ${chunking.label} chunks identically to a full parse`, () => {
        const session = createMarkdownContentSession('')
        let accumulated = ''
        for (const chunk of chunking.make(source)) {
          const snapshot = session.append(chunk)
          accumulated += chunk
          // At EVERY step the incremental document must equal a fresh full parse
          // of everything streamed so far — same structure, same node ids.
          expect(snapshot.document).toEqual(parseMarkdownContent(accumulated))
          expect(snapshot.source).toBe(accumulated)
        }
        expect(accumulated).toBe(source)
      })
    }
  }

  it('replace() resets to a fresh full parse', () => {
    const session = createMarkdownContentSession('seed text')
    const snapshot = session.replace(CORPUS.mixed ?? '')
    expect(snapshot.document).toEqual(parseMarkdownContent(CORPUS.mixed ?? ''))
    expect(snapshot.source).toBe(CORPUS.mixed)
  })

  it('an initialSource matches a full parse', () => {
    const session = createMarkdownContentSession(CORPUS.mixed ?? '')
    expect(session.snapshot().document).toEqual(parseMarkdownContent(CORPUS.mixed ?? ''))
  })
})

describe('createMarkdownContentSession — settled node identity (issue #338/#340)', () => {
  it('keeps a stabilized block the same object across later appends', () => {
    const session = createMarkdownContentSession('')
    // The first paragraph stabilizes once the next block's first line has fully
    // arrived (terminated), so its object identity is fixed from here on.
    session.append('First paragraph.\n\nSecond paragraph.\n')
    const stabilized = session.snapshot().document.nodes[0]
    expect(stabilized?.type).toBe('paragraph')

    session.append('\nThird')
    expect(session.snapshot().document.nodes[0]).toBe(stabilized)

    session.append(' paragraph.')
    expect(session.snapshot().document.nodes[0]).toBe(stabilized)
  })
})

describe('createMarkdownContentSession — bounded parse work (issue #338)', () => {
  it('parses O(n) total, never re-parsing the whole document', () => {
    // 40 paragraphs of ~80 chars, blank-line separated.
    const paragraph = (i: number): string =>
      `Paragraph ${String(i).padStart(2, '0')} — ${'lorem ipsum dolor sit amet '.repeat(2)}`.slice(
        0,
        80
      )
    const paras = Array.from({ length: 40 }, (_, i) => paragraph(i))
    const source = paras.join('\n\n')
    const paraLen = (paras[0] ?? '').length // 80

    const inputs: number[] = []
    const counting: typeof parseMarkdownFragment = (content, state) => {
      inputs.push(content.length)
      return parseMarkdownFragment(content, state)
    }
    const session = createMarkdownContentSessionWith(counting)('')

    let appended = 0
    let markAfterFive = -1
    for (const chunk of chunkFixed(source, 20)) {
      session.append(chunk)
      appended += chunk.length
      if (markAfterFive < 0 && appended >= paraLen * 5) {
        markAfterFive = inputs.length
      }
    }

    const totalParsed = inputs.reduce((sum, n) => sum + n, 0)
    const lateMax = Math.max(...inputs.slice(Math.max(markAfterFive, 0)))

    // Measured with the incremental implementation: totalParsed ≈ 6.5× the
    // document length (vs ≈ 80× for the old full-reparse-per-delta code), and
    // the largest late parse ≈ 1 paragraph (vs the whole document for the old
    // code). Generous bounds that still fail loudly for an O(n²) regression.
    expect(totalParsed).toBeLessThan(source.length * 12)
    expect(lateMax).toBeLessThan(paraLen * 3)
  })
})

describe('findStableBoundary (issue #338)', () => {
  it('returns null while inside an open fenced code block', () => {
    expect(findStableBoundary('```\ncode\n\nmore code\n')).toBeNull()
  })

  it('splits after a closed fence, before the next block', () => {
    // The next line must be terminated for the split to be taken.
    const pending = '```\ncode\n```\n\npara\nmore'
    const boundary = findStableBoundary(pending)
    expect(boundary).not.toBeNull()
    expect(pending.slice(boundary ?? 0)).toBe('para\nmore')
  })

  it('splits only before a following paragraph, never between loose list items', () => {
    const pending = '- a\n\n- b\n\nplain\n'
    const boundary = findStableBoundary(pending)
    expect(pending.slice(boundary ?? 0)).toBe('plain\n')
    // The blank between the two items must not be a boundary.
    expect(findStableBoundary('- a\n\n- b\n')).toBeNull()
    // A second item arriving as a bare marker char must not trigger a split.
    expect(findStableBoundary('- a\n\n-')).toBeNull()
  })

  it('returns null when the next block line has not fully arrived', () => {
    // `para` is unterminated, so its shape can still change.
    expect(findStableBoundary('a\n\npara')).toBeNull()
  })

  it('returns null when the blank line is at the end of pending', () => {
    expect(findStableBoundary('a\n\n')).toBeNull()
  })

  it('returns null while an HTML comment is open across the blank line', () => {
    expect(findStableBoundary('<!-- open\n\npara\n')).toBeNull()
  })

  it('returns null while a raw SVG data URI is unterminated', () => {
    expect(findStableBoundary('![a](data:image/svg+xml,<svg>\n\npara\n')).toBeNull()
  })

  it('handles CRLF blank lines', () => {
    const pending = 'a\r\n\r\nb\r\nc'
    const boundary = findStableBoundary(pending)
    expect(pending.slice(boundary ?? 0)).toBe('b\r\nc')
  })

  it('returns null with no blank line at all', () => {
    expect(findStableBoundary('abc')).toBeNull()
    expect(findStableBoundary('')).toBeNull()
  })
})
