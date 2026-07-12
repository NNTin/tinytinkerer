import { describe, expect, it, vi } from 'vitest'
import { createFileTools } from '../src/index'

describe('shared file tools', () => {
  it('routes both tools through the injected host', async () => {
    const readFiles = vi.fn(() => ({ files: [] }))
    const applyFileChanges = vi.fn(() => ({ changes: [] }))
    const tools = createFileTools({ readFiles, applyFileChanges })
    await tools[0]?.execute({ paths: ['/diagram.mmd'] })
    await tools[1]?.execute({
      changes: [{ kind: 'create', path: '/diagram.mmd', content: 'flowchart TD' }]
    })
    expect(readFiles).toHaveBeenCalledOnce()
    expect(applyFileChanges).toHaveBeenCalledOnce()
  })
})
