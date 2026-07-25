// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLAYGROUND_EXAMPLE_ID,
  findPlaygroundExample,
  PLAYGROUND_EXAMPLES,
  RENDERER_EXCEPTION_LANGUAGE,
  type PlaygroundExampleCategory
} from '../constants'

const REQUIRED_CATEGORIES: readonly PlaygroundExampleCategory[] = [
  'markdown',
  'mermaid',
  'wireframe',
  'code',
  'callout',
  'link-card',
  'table',
  'image'
]

describe('PLAYGROUND_EXAMPLES', () => {
  it('has unique, non-empty ids and markdown source', () => {
    const ids = PLAYGROUND_EXAMPLES.map((example) => example.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const example of PLAYGROUND_EXAMPLES) {
      expect(example.markdown.trim().length).toBeGreaterThan(0)
      expect(example.label.trim().length).toBeGreaterThan(0)
      expect(example.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('ships at least one working example per specialized renderer', () => {
    for (const category of REQUIRED_CATEGORIES) {
      const matching = PLAYGROUND_EXAMPLES.filter((example) => example.category === category)
      expect(matching.length, `expected an example for category "${category}"`).toBeGreaterThan(0)
    }
  })

  it('ships malformed/unsupported examples for fallback containment', () => {
    const malformed = PLAYGROUND_EXAMPLES.filter((example) => example.category === 'malformed')
    expect(malformed.length).toBeGreaterThanOrEqual(3)
  })

  it('image examples never reference a network URL', () => {
    const image = PLAYGROUND_EXAMPLES.find((example) => example.category === 'image')
    expect(image).toBeDefined()
    expect(image!.markdown).toMatch(/\(data:image\/svg\+xml,/)
    expect(image!.markdown).not.toMatch(/https?:\/\//)
  })

  it('the renderer-exception demo fences the language app-browser treats as always-throwing', () => {
    const demo = PLAYGROUND_EXAMPLES.find((example) => example.id === 'renderer-exception')
    expect(demo).toBeDefined()
    expect(demo!.markdown).toContain(`\`\`\`${RENDERER_EXCEPTION_LANGUAGE}`)
  })

  it('DEFAULT_PLAYGROUND_EXAMPLE_ID resolves to a real example', () => {
    expect(findPlaygroundExample(DEFAULT_PLAYGROUND_EXAMPLE_ID)).toBeDefined()
  })

  it('findPlaygroundExample returns undefined for unknown or null ids', () => {
    expect(findPlaygroundExample('does-not-exist')).toBeUndefined()
    expect(findPlaygroundExample(null)).toBeUndefined()
  })
})
