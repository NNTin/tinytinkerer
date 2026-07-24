import { describe, expect, it } from 'vitest'
import {
  createIdeAppTools,
  summarizeInspectRuntimeActivity,
  summarizeInspectWorkspaceActivity,
  summarizeRestartRuntimeActivity,
  summarizeSearchFilesActivity
} from './ide-runtime'

describe('IDE tool activity outcomes', () => {
  it('gives every IDE tool an owner summarizer', () => {
    expect(createIdeAppTools()).toHaveLength(6)
    expect(createIdeAppTools().every((tool) => tool.summarizeActivity)).toBe(true)
  })

  it('classifies workspace and runtime health', () => {
    expect(
      summarizeInspectWorkspaceActivity({ files: [], runtime: { status: 'idle', error: null } })
    ).toMatchObject({ status: 'ok' })
    expect(
      summarizeInspectWorkspaceActivity({
        files: [],
        runtime: { status: 'idle', error: 'Compile failed' }
      })
    ).toMatchObject({ status: 'error' })
    expect(
      summarizeInspectRuntimeActivity({ status: 'idle', error: null, logs: [] })
    ).toMatchObject({ status: 'ok' })
    expect(summarizeInspectRuntimeActivity({ status: 'idle', error: 'Boom' })).toMatchObject({
      status: 'error'
    })
  })

  it('warns for empty or truncated searches and validates restart receipts', () => {
    expect(
      summarizeSearchFilesActivity({ query: 'x', results: [], truncated: false })
    ).toMatchObject({ status: 'warn' })
    expect(
      summarizeSearchFilesActivity({ query: 'x', results: [{ path: '/x' }], truncated: false })
    ).toMatchObject({ status: 'ok' })
    expect(summarizeRestartRuntimeActivity({ restarted: true })).toMatchObject({ status: 'ok' })
    expect(summarizeRestartRuntimeActivity({ restarted: false })).toMatchObject({
      status: 'error'
    })
  })
})
