import { describe, expect, it } from 'vitest'
import { summarizeApplyFileChangesActivity, summarizeReadFilesActivity } from '../src/index'

describe('file-tool activity outcomes', () => {
  it('marks reads OK without diagnostics and warning/error from diagnostic severity', () => {
    expect(summarizeReadFilesActivity({ files: [] })).toMatchObject({ status: 'ok' })
    expect(
      summarizeReadFilesActivity({
        files: [],
        diagnostics: [{ path: '/a', severity: 'warning', message: 'heads up' }]
      })
    ).toMatchObject({ status: 'warn' })
    expect(
      summarizeReadFilesActivity({
        files: [],
        diagnostics: [{ path: '/a', severity: 'error', message: 'broken' }]
      })
    ).toMatchObject({ status: 'error' })
  })

  it('marks applied changes OK without diagnostics and rejects malformed results', () => {
    expect(
      summarizeApplyFileChangesActivity({ workspaceRevision: 2, changes: [{ path: '/a' }] })
    ).toMatchObject({ status: 'ok' })
    expect(summarizeApplyFileChangesActivity({})).toMatchObject({ status: 'error' })
  })
})
