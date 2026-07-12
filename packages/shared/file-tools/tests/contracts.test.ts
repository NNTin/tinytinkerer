import { describe, expect, it } from 'vitest'
import { applyFileChangesInputSchema, readFilesInputSchema } from '../src/index'

describe('shared file tool contracts', () => {
  it('accepts revision-safe operations and applies defaults', () => {
    expect(
      applyFileChangesInputSchema.parse({
        changes: [
          { kind: 'create', path: '/src/new.ts', content: 'export {}' },
          {
            kind: 'edit',
            path: '/src/existing.ts',
            expectedRevision: 3,
            oldText: 'before',
            newText: 'after'
          }
        ]
      })
    ).toMatchObject({ changes: [{ kind: 'create' }, { kind: 'edit', replaceAll: false }] })
  })

  it('rejects traversal, relative paths, and empty batches', () => {
    expect(() => readFilesInputSchema.parse({ paths: ['src/app.ts'] })).toThrow()
    expect(() => readFilesInputSchema.parse({ paths: ['/src/../secret'] })).toThrow()
    expect(() => applyFileChangesInputSchema.parse({ changes: [] })).toThrow()
  })
})
