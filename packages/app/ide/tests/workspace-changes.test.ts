import { describe, expect, it } from 'vitest'
import { applyWorkspaceChanges, type WorkspaceChangeState } from '../src/workspace-changes'

const state = (overrides: Partial<WorkspaceChangeState> = {}): WorkspaceChangeState => ({
  files: { '/App.tsx': 'old app', '/styles.css': 'old styles' },
  revisions: {},
  deletedPaths: new Set(),
  ...overrides
})

describe('IDE workspace changes', () => {
  it('accepts revision zero for untouched files in a mixed-revision batch', () => {
    const result = applyWorkspaceChanges(state({ revisions: { '/App.tsx': 8 } }), {
      changes: [
        {
          kind: 'replace',
          path: '/App.tsx',
          expectedRevision: 8,
          content: 'new app'
        },
        {
          kind: 'replace',
          path: '/styles.css',
          expectedRevision: 0,
          content: 'new styles'
        }
      ]
    })

    expect(result.files).toEqual({ '/App.tsx': 'new app', '/styles.css': 'new styles' })
    expect(result.revisions).toEqual({ '/App.tsx': 9, '/styles.css': 1 })
  })

  it('uses revision zero for edit, move, and delete operations', () => {
    const edited = applyWorkspaceChanges(state(), {
      changes: [
        {
          kind: 'edit',
          path: '/App.tsx',
          expectedRevision: 0,
          oldText: 'old',
          newText: 'new',
          replaceAll: false
        }
      ]
    })
    expect(edited.files['/App.tsx']).toBe('new app')
    expect(edited.revisions['/App.tsx']).toBe(1)

    const moved = applyWorkspaceChanges(state(), {
      changes: [
        {
          kind: 'move',
          path: '/App.tsx',
          destination: '/src/App.tsx',
          expectedRevision: 0
        }
      ]
    })
    expect(moved.files['/App.tsx']).toBeUndefined()
    expect(moved.files['/src/App.tsx']).toBe('old app')
    expect(moved.revisions['/src/App.tsx']).toBe(1)
    expect(moved.deletedPaths).toContain('/App.tsx')

    const deleted = applyWorkspaceChanges(state(), {
      changes: [{ kind: 'delete', path: '/App.tsx', expectedRevision: 0 }]
    })
    expect(deleted.files['/App.tsx']).toBeUndefined()
    expect(deleted.revisions['/App.tsx']).toBeUndefined()
    expect(deleted.deletedPaths).toContain('/App.tsx')
  })

  it('rejects stale revisions with actionable current-revision details', () => {
    expect(() =>
      applyWorkspaceChanges(state({ revisions: { '/App.tsx': 3 } }), {
        changes: [
          {
            kind: 'replace',
            path: '/App.tsx',
            expectedRevision: 2,
            content: 'stale write'
          }
        ]
      })
    ).toThrow(
      'Revision conflict for /App.tsx: expected 2, current 3. Re-read /App.tsx and recompute the change before retrying.'
    )
  })

  it('does not mutate workspace state when a later change fails', () => {
    const original = state({ revisions: { '/styles.css': 2 } })
    const originalFiles = { ...original.files }
    const originalRevisions = { ...original.revisions }
    const originalDeletedPaths = new Set(original.deletedPaths)

    expect(() =>
      applyWorkspaceChanges(original, {
        changes: [
          {
            kind: 'replace',
            path: '/App.tsx',
            expectedRevision: 0,
            content: 'would have changed'
          },
          {
            kind: 'replace',
            path: '/styles.css',
            expectedRevision: 1,
            content: 'stale write'
          }
        ]
      })
    ).toThrow(/Revision conflict/)

    expect(original.files).toEqual(originalFiles)
    expect(original.revisions).toEqual(originalRevisions)
    expect(original.deletedPaths).toEqual(originalDeletedPaths)
  })

  it('increments a file revision only once when a batch touches it repeatedly', () => {
    const result = applyWorkspaceChanges(state(), {
      changes: [
        {
          kind: 'edit',
          path: '/App.tsx',
          expectedRevision: 0,
          oldText: 'old',
          newText: 'new',
          replaceAll: false
        },
        {
          kind: 'edit',
          path: '/App.tsx',
          expectedRevision: 0,
          oldText: 'app',
          newText: 'application',
          replaceAll: false
        }
      ]
    })

    expect(result.files['/App.tsx']).toBe('new application')
    expect(result.revisions['/App.tsx']).toBe(1)
    expect(result.touchedPaths).toEqual(['/App.tsx'])
  })
})
