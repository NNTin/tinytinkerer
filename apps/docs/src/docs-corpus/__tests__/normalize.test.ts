import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import canonicalFixture from '../__fixtures__/canonical.mdx?raw'
import interactiveFixture from '../__fixtures__/interactive.mdx?raw'
import { normalizeDocumentation } from '../normalize'

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
    expect(normalized.markdown).toContain(':::note Supported admonition')
    expect(normalized.markdown).toContain('## Not a real section')
    expect(normalized.markdown).toContain("import NotExecutable from './inside-a-fence'")
    expect(anchors).toEqual([
      'corpus-fixture',
      'repeated-heading',
      'child-section',
      'repeated-heading-1',
      'explicit-comment',
      'explicit-classic',
      'the-api',
      'heading-in-an-admonition'
    ])
    expect(anchors).not.toContain('not-a-real-section')
    expect(normalized.markdown).toContain('## Explicit classic \\{#explicit-classic}')
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
    expect(anchors).toEqual(['mdx-fixture', 'duplicate', 'duplicate-2'])
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
    expect(normalized.outline[0]?.children[0]?.anchor).toBe('repeated-heading')
    expect(normalized.outline[0]?.children[0]?.children[0]?.anchor).toBe('child-section')
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
      expect(section.characterCount).toBe(section.endOffset - section.startOffset)
    }
  })
})
