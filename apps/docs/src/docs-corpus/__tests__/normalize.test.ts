import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import canonicalFixture from '../__fixtures__/canonical.mdx?raw'
import interactiveFixture from '../__fixtures__/interactive.mdx?raw'
import { normalizeDocumentation } from '../normalize'

const selectSection = (
  normalized: ReturnType<typeof normalizeDocumentation>,
  anchor: string
): string => {
  const section = normalized.sections.find((candidate) => candidate.anchor === anchor)
  if (!section) throw new Error(`missing test section ${anchor}`)
  return (
    section.selectionPrefix +
    normalized.markdown.slice(section.startOffset, section.endOffset) +
    section.selectionSuffix
  )
}

describe('normalizeDocumentation', () => {
  it('preserves Markdown, GFM, fences, directives, and Docusaurus anchors', () => {
    const normalized = normalizeDocumentation(canonicalFixture, 'Canonical fixture')
    const anchors = normalized.sections.flatMap((section) =>
      section.anchor ? [section.anchor] : []
    )

    expect(normalized.markdown).not.toContain('title: Frontmatter')
    expect(normalized.markdown).toContain('[links](https://example.com)')
    expect(normalized.markdown).toContain('- [x] A task')
    expect(normalized.markdown).toContain('| Feature | Preserved |')
    expect(normalized.markdown).toContain(':::note[Supported admonition]')
    expect(normalized.markdown).toContain('## Not a real section')
    expect(normalized.markdown).toContain("import NotExecutable from './inside-a-fence'")
    expect(anchors).toEqual([
      'repeated-heading',
      'child-section',
      'repeated-heading-1',
      'explicit-comment',
      'explicit-html',
      'explicit-classic',
      'the-api',
      'heading-in-a-blockquote',
      'heading-in-a-list',
      'heading-in-an-admonition'
    ])
    expect(anchors).not.toContain('not-a-real-section')
    expect(normalized.sections.find((section) => section.depth === 1)?.anchor).toBeNull()
    expect(normalized.markdown).toContain('## Explicit classic \\{#explicit-classic}')
    expect(normalized.markdown).toContain('## Explicit comment {/* #explicit-comment */}')
    expect(normalized.markdown).toContain('## Explicit HTML comment <!-- #explicit-html -->')
    expect(normalized.markdown).not.toContain('Editorial note')
    expect(normalized.markdown).not.toContain('Another hidden editorial note')
  })

  it('removes executable MDX and marks component/expression omissions without using runtime output', () => {
    const normalized = normalizeDocumentation(interactiveFixture, 'Interactive fixture')
    const anchors = normalized.sections.flatMap((section) =>
      section.anchor ? [section.anchor] : []
    )

    expect(normalized.markdown).not.toContain('import Widget')
    expect(normalized.markdown).not.toContain('export const answer')
    expect(normalized.markdown).not.toContain('<Widget')
    expect(normalized.markdown).not.toContain('Runtime-owned component content')
    expect(normalized.markdown).toContain('[non-executable MDX expression omitted]')
    expect(normalized.markdown).toContain('**Non-executable MDX omitted.**')
    // The omitted component's heading still occupies Docusaurus' duplicate
    // slug, so the later retained heading has the rendered page's real anchor.
    expect(anchors).toEqual(['duplicate', 'duplicate-2'])
    expect(normalized.markdown).not.toContain('hidden comment-only expression')
  })

  it('keeps H1 slug accounting without exposing theme-classic fragments', () => {
    const normalized = normalizeDocumentation(
      '# Duplicate\n\n## Duplicate\n\n# Duplicate\n\n## Duplicate\n',
      'H1 identity'
    )

    expect(normalized.sections.map(({ depth, anchor }) => ({ depth, anchor }))).toEqual([
      { depth: 0, anchor: null },
      { depth: 1, anchor: null },
      { depth: 2, anchor: 'duplicate-1' },
      { depth: 1, anchor: null },
      { depth: 2, anchor: 'duplicate-3' }
    ])
    expect(normalized.outline.map((item) => item.anchor)).toEqual(['duplicate-1', 'duplicate-3'])
  })

  it('matches Docusaurus heading text rules for authored Markdown HTML', () => {
    const normalized = normalizeDocumentation(
      '## The <code>API</code>\n\nReadable.\n',
      'HTML heading',
      'md'
    )
    expect(normalized.sections[1]?.anchor).toBe('the-api')
    expect(normalized.sections[1]?.title).toBe('The API')
  })

  it('emits hierarchical, sliceable section boundaries and a nested outline', () => {
    const normalized = normalizeDocumentation(canonicalFixture, 'Canonical fixture')
    const parent = normalized.sections.find((section) => section.anchor === 'repeated-heading')
    const child = normalized.sections.find((section) => section.anchor === 'child-section')
    const nextPeer = normalized.sections.find((section) => section.anchor === 'repeated-heading-1')

    expect(parent).toBeDefined()
    expect(child?.parentAnchor).toBe('repeated-heading')
    expect(parent?.endOffset).toBe(nextPeer?.startOffset)
    expect(normalized.markdown.slice(parent?.startOffset, parent?.endOffset)).toContain(
      '### Child section'
    )
    expect(normalized.markdown.slice(child?.startOffset, child?.endOffset)).not.toContain(
      '## Repeated heading\n\nSecond occurrence.'
    )
    expect(normalized.outline[0]?.anchor).toBe('repeated-heading')
    expect(normalized.outline[0]?.children[0]?.anchor).toBe('child-section')
  })

  it('makes nested container sections independently valid Markdown selections', () => {
    const normalized = normalizeDocumentation(canonicalFixture, 'Canonical fixture')

    expect(selectSection(normalized, 'heading-in-a-blockquote')).toBe(
      '> ## Heading in a blockquote\n>\n> Quoted prose stays inside the selected section.\n\n'
    )
    expect(selectSection(normalized, 'heading-in-a-list')).toBe(
      '- ## Heading in a list\n\n  Listed prose stays inside the selected section.\n\n'
    )
    expect(selectSection(normalized, 'heading-in-an-admonition')).toBe(
      ':::note[Supported admonition]\n\n## Heading in an admonition\n\nThe directive and its authored content stay readable.\n\n:::\n'
    )
  })

  it('splits the repository oversized page into addressable sections', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../../docs/plugins-and-tools/plugin-infrastructure.md'),
      'utf8'
    )
    expect(Buffer.byteLength(source, 'utf8')).toBeGreaterThan(54_000)

    const normalized = normalizeDocumentation(source, 'Plugin infrastructure', 'md')
    expect(normalized.sections.length).toBeGreaterThan(10)
    expect(normalized.outline.length).toBeGreaterThan(0)
    expect(
      Math.max(
        ...normalized.sections
          .filter((section) => section.depth >= 2)
          .map((section) => section.characterCount)
      )
    ).toBeLessThan(10_000)
    for (const section of normalized.sections) {
      expect(section.endOffset).toBeGreaterThanOrEqual(section.contentStartOffset)
      expect(section.characterCount).toBe(
        section.selectionPrefix.length +
          section.endOffset -
          section.startOffset +
          section.selectionSuffix.length
      )
    }
  })
})
