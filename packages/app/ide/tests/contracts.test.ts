import { describe, expect, it } from 'vitest'
import {
  applyFileChangesInputSchema,
  inspectRuntimeInputSchema,
  readFilesInputSchema,
  searchFilesInputSchema
} from '../src/contracts'

describe('IDE tool contracts', () => {
  it('accepts canonical revision-safe file operations', () => {
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

  it('applies bounded defaults for search and runtime inspection', () => {
    expect(searchFilesInputSchema.parse({ query: 'button' }).maxResults).toBe(30)
    expect(inspectRuntimeInputSchema.parse({}).maxLogs).toBe(50)
  })
})
