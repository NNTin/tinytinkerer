/**
 * The selection primitives, isolated from fetching and from the tool wrapper.
 *
 * `read-document.test.ts` covers what a caller actually receives; this covers
 * the two rules that decide whether that output is any good — where a cut may
 * land, and how the budget is shared.
 */
import { describe, expect, it } from 'vitest'
import { allocateBudget, flattenOutline, truncateMarkdown } from '../selection'

describe('truncateMarkdown', () => {
  it('returns short text untouched', () => {
    expect(truncateMarkdown('# Title\n\nBody.\n', 1_000)).toBe('# Title\n\nBody.\n')
  })

  it('cuts at a line boundary, never mid-line', () => {
    const text = Array.from({ length: 40 }, (_, index) => `- item ${index}`).join('\n')
    const result = truncateMarkdown(text, 120)

    const body = result.slice(0, result.indexOf('…'))
    for (const line of body.split('\n').filter(Boolean)) {
      expect(line).toMatch(/^- item \d+$/)
    }
  })

  it('prefers a paragraph boundary when one is close by', () => {
    const text = `First paragraph.\n\n${'x'.repeat(20)}\nmore\nmore\n`
    const result = truncateMarkdown(text, 60)
    expect(result.startsWith('First paragraph.\n\n')).toBe(true)
  })

  it('closes a fenced block it cut into, rather than abandoning the budget', () => {
    const text = `## Heading\n\n\`\`\`ts\n${Array.from({ length: 60 }, (_, i) => `const line${i} = ${i}`).join('\n')}\n\`\`\`\n`
    const result = truncateMarkdown(text, 400)

    // Content, not just the heading: retreating past the fence would return
    // roughly the first line and waste the rest of the budget.
    expect(result.length).toBeGreaterThan(300)
    expect(result).toContain('const line0 = 0')
    const fences = result.split('\n').filter((line) => /^\s{0,3}(`{3,}|~{3,})/.test(line))
    expect(fences).toHaveLength(2)
    expect(result.trimEnd().endsWith('[truncated]')).toBe(true)
  })

  it('closes a tilde fence with tildes', () => {
    const text = `~~~\n${'a\n'.repeat(200)}~~~\n`
    const result = truncateMarkdown(text, 200)
    expect(result.split('\n').filter((line) => line.startsWith('~~~'))).toHaveLength(2)
  })

  it('never exceeds the budget it was given', () => {
    const text = `${'paragraph text here.\n\n'.repeat(500)}`
    for (const budget of [50, 200, 1_000, 5_000]) {
      expect(truncateMarkdown(text, budget).length).toBeLessThanOrEqual(budget)
    }
  })

  it('returns nothing when the budget cannot hold even the marker', () => {
    expect(truncateMarkdown('a'.repeat(100), 5)).toBe('')
  })
})

describe('allocateBudget', () => {
  it('gives everything to a set that fits', () => {
    expect(allocateBudget([10, 20, 30], 1_000)).toEqual([10, 20, 30])
  })

  it('shares equally when nothing fits', () => {
    expect(allocateBudget([1_000, 1_000, 1_000], 300)).toEqual([100, 100, 100])
  })

  it('redistributes what small sections do not need', () => {
    // 10 + a fair share of the rest, rather than 300/3 each: the point of
    // max-min fairness is that a small section cannot hoard budget a large one
    // could use.
    const allocation = allocateBudget([10, 1_000, 1_000], 300)
    expect(allocation[0]).toBe(10)
    expect(allocation[1]).toBe(145)
    expect(allocation[2]).toBe(145)
  })

  it('never allocates more than the budget', () => {
    const sizes = [3_147, 7_458, 1_390, 1_973, 3_514, 5_249, 7_134, 7_883]
    const total = allocateBudget(sizes, 20_000).reduce((sum, value) => sum + value, 0)
    expect(total).toBeLessThanOrEqual(20_000)
  })

  it('guarantees a floor, unlike proportional allocation', () => {
    // Proportional would give the 100-character section 100/50_100 * 5_000 ≈ 9
    // characters — a heading fragment and nothing else.
    const allocation = allocateBudget([100, 50_000], 5_000)
    expect(allocation[0]).toBe(100)
    // The small section takes only what it needs; the surplus is not stranded.
    expect(allocation[1]).toBe(4_900)
  })
})

describe('flattenOutline', () => {
  it('flattens nested headings into document order, keeping depth as level', () => {
    expect(
      flattenOutline([
        {
          anchor: 'a',
          title: 'A',
          depth: 2,
          sectionIndex: 1,
          children: [{ anchor: 'a-1', title: 'A one', depth: 3, sectionIndex: 2, children: [] }]
        },
        { anchor: 'b', title: 'B', depth: 2, sectionIndex: 3, children: [] }
      ])
    ).toEqual([
      { heading: 'A', level: 2, anchor: 'a' },
      { heading: 'A one', level: 3, anchor: 'a-1' },
      { heading: 'B', level: 2, anchor: 'b' }
    ])
  })
})
