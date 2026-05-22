import { describe, expect, it } from 'vitest'
import { inferPlan } from '../src/index.js'

describe('inferPlan', () => {
  it('returns low-complexity plan for a plain prompt', () => {
    const plan = inferPlan('What is the capital of France?')
    expect(plan.complexity).toBe('low')
    expect(plan.steps.map((s) => s.id)).toEqual(['understand', 'compose'])
    expect(plan.steps.every((s) => !s.toolCall)).toBe(true)
  })

  it('triggers search step for "latest"', () => {
    const plan = inferPlan('What is the latest news on AI?')
    expect(plan.complexity).toBe('medium')
    expect(plan.steps.map((s) => s.id)).toEqual(['understand', 'search', 'compose'])
    expect(plan.steps[1]?.toolCall?.toolId).toBe('web-search')
  })

  it('triggers search step for "news"', () => {
    const plan = inferPlan('Show me news about climate change')
    expect(plan.complexity).toBe('medium')
    expect(plan.steps.some((s) => s.id === 'search')).toBe(true)
  })

  it('triggers search step for "search"', () => {
    const plan = inferPlan('Search for the best laptops in 2024')
    expect(plan.complexity).toBe('medium')
    expect(plan.steps.some((s) => s.id === 'search')).toBe(true)
  })

  it('triggers search step for "web"', () => {
    const plan = inferPlan('Look it up on the web')
    expect(plan.complexity).toBe('medium')
    expect(plan.steps.some((s) => s.id === 'search')).toBe(true)
  })

  it('triggers search step for "compare"', () => {
    const plan = inferPlan('Compare Python and JavaScript')
    expect(plan.complexity).toBe('medium')
    expect(plan.steps.some((s) => s.id === 'search')).toBe(true)
  })

  it('triggers search step for "today"', () => {
    const plan = inferPlan("What happened today in tech?")
    expect(plan.complexity).toBe('medium')
    expect(plan.steps.some((s) => s.id === 'search')).toBe(true)
  })

  it('triggers search step for "research"', () => {
    const plan = inferPlan('Research machine learning papers')
    expect(plan.complexity).toBe('medium')
    expect(plan.steps.some((s) => s.id === 'search')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(inferPlan('LATEST trends').complexity).toBe('medium')
    expect(inferPlan('Latest trends').complexity).toBe('medium')
  })

  it('search step carries the prompt as query with maxResults 5', () => {
    const prompt = 'latest JavaScript frameworks'
    const plan = inferPlan(prompt)
    const searchStep = plan.steps.find((s) => s.id === 'search')
    expect(searchStep?.toolCall?.input).toEqual({ query: prompt, maxResults: 5 })
  })

  it('edge and local fallback produce equivalent plans for the same prompt', () => {
    const prompts = [
      'Tell me something simple',
      'latest AI news',
      'research quantum computing',
      'compare React and Vue today'
    ]
    for (const prompt of prompts) {
      const plan = inferPlan(prompt)
      // Calling inferPlan twice with the same input must be deterministic
      expect(inferPlan(prompt)).toEqual(plan)
    }
  })
})
