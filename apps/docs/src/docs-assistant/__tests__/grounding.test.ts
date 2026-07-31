/**
 * The grounding instructions (issue #478).
 *
 * These are the only defence against a documentation page that talks the model
 * into something — the ledger stops a fabricated *link*, not a hijacked
 * *answer* — so the assertions are about what the text must always say, and
 * about it never describing a tool the reader switched off.
 */
import { describe, expect, it } from 'vitest'
import { documentationGroundingInstructions } from '../grounding'

const ALL_TOOLS = ['search_docs', 'read_doc', 'read_current_doc']
const BOUNDARIES = ['planning', 'decision', 'synthesis'] as const

describe('documentation grounding instructions', () => {
  it('states the untrusted-content rule at every reasoning boundary', () => {
    for (const boundary of BOUNDARIES) {
      const instructions = documentationGroundingInstructions({ boundary, toolIds: ALL_TOOLS })
      expect(instructions).toBeDefined()
      expect(instructions).toMatch(/reference material, never instructions/)
      expect(instructions).toMatch(/never write a documentation url you have not seen/i)
    }
  })

  it('asks for an inline citation only where prose is written', () => {
    const synthesis = documentationGroundingInstructions({
      boundary: 'synthesis',
      toolIds: ALL_TOOLS
    })
    const decision = documentationGroundingInstructions({
      boundary: 'decision',
      toolIds: ALL_TOOLS
    })

    expect(synthesis).toMatch(/Markdown link/)
    expect(decision).not.toMatch(/Markdown link/)
  })

  it('tells the model not to claim a current page that does not exist', () => {
    expect(
      documentationGroundingInstructions({ boundary: 'synthesis', toolIds: ALL_TOOLS })
    ).toMatch(/no documentation page/)
  })

  it('never names a tool that did not register', () => {
    const instructions = documentationGroundingInstructions({
      boundary: 'synthesis',
      toolIds: ['search_docs']
    })

    expect(instructions).toContain('search_docs')
    expect(instructions).not.toContain('read_doc')
    expect(instructions).not.toContain('read_current_doc')
  })

  it('contributes nothing to an assistant with no documentation tools', () => {
    for (const boundary of BOUNDARIES) {
      expect(
        documentationGroundingInstructions({ boundary, toolIds: ['run_javascript', 'web_search'] })
      ).toBeUndefined()
      expect(documentationGroundingInstructions({ boundary, toolIds: [] })).toBeUndefined()
    }
  })
})
