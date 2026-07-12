import { describe, expect, it } from 'vitest'
import { buildMermaidFixPrompt } from '../src/fix-prompt'

describe('Mermaid assistant repair prompt', () => {
  it('includes the diagnostic, revision, path, and nearby source', () => {
    const prompt = buildMermaidFixPrompt('flowchart TD\nA -->\nB --> C', 7, {
      path: '/diagram.mmd',
      severity: 'error',
      message: 'Parse error on line 2',
      line: 2
    })
    expect(prompt).toContain('/diagram.mmd')
    expect(prompt).toContain('revision 7')
    expect(prompt).toContain('Parse error on line 2')
    expect(prompt).toContain('2: A -->')
  })
})
