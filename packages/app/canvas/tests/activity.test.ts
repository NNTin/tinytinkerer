import { describe, expect, it } from 'vitest'
import { canvasActivitySummarizers } from '../src/activity'
import { createCanvasAppTools } from '../src/tools'

const complete = { ok: true, truncation: { truncated: false } }

describe('canvas activity outcomes', () => {
  it('gives every Canvas verb an owner summarizer', () => {
    const tools = createCanvasAppTools({
      request: () => Promise.resolve({ ok: true })
    })
    expect(tools).toHaveLength(25)
    expect(tools.every((tool) => tool.summarizeActivity)).toBe(true)
  })

  it('classifies query misses, missing IDs, and partial results as warnings', () => {
    expect(canvasActivitySummarizers.search({ ...complete, matched: 2 })).toMatchObject({
      status: 'ok'
    })
    expect(canvasActivitySummarizers.search({ ...complete, matched: 0 })).toMatchObject({
      status: 'warn'
    })
    expect(
      canvasActivitySummarizers.inspect({ ...complete, missingIds: ['missing'] })
    ).toMatchObject({ status: 'warn' })
    expect(
      canvasActivitySummarizers.read({
        ...complete,
        missingIds: [],
        truncation: { truncated: true }
      })
    ).toMatchObject({ status: 'warn' })
  })

  it('classifies completed no-op mutations and health findings as warnings', () => {
    expect(canvasActivitySummarizers.edit({ ...complete, updated: 1 })).toMatchObject({
      status: 'ok'
    })
    expect(canvasActivitySummarizers.edit({ ...complete, updated: 0 })).toMatchObject({
      status: 'warn'
    })
    expect(
      canvasActivitySummarizers.audit({
        ...complete,
        flagged: 1,
        missingIds: []
      })
    ).toMatchObject({ status: 'warn' })
    expect(
      canvasActivitySummarizers.survey({
        ...complete,
        findings: [{ kind: 'overlap' }],
        missingIds: []
      })
    ).toMatchObject({ status: 'warn' })
  })

  it('classifies degraded preview, thumbnail, and selection results as warnings', () => {
    expect(
      canvasActivitySummarizers.preview({
        ...complete,
        wouldChange: true,
        thumbnailReason: 'rendered'
      })
    ).toMatchObject({ status: 'ok' })
    expect(
      canvasActivitySummarizers.preview({
        ...complete,
        wouldChange: false,
        thumbnailReason: 'no-change'
      })
    ).toMatchObject({ status: 'warn' })
    expect(
      canvasActivitySummarizers.thumbnail({ ...complete, media: [], missingIds: [] })
    ).toMatchObject({ status: 'warn' })
    expect(
      canvasActivitySummarizers.pick({ ...complete, timedOut: true, selectedCount: 0 })
    ).toMatchObject({ status: 'warn' })
  })

  it('keeps preview and thumbnail media renderable in the curated view', async () => {
    const view = await canvasActivitySummarizers.thumbnail({
      ...complete,
      elementCount: 1,
      missingIds: [],
      media: [
        {
          kind: 'image',
          dataUrl: 'data:image/png;base64,abcd',
          mimeType: 'image/png',
          width: 10,
          height: 10,
          description: 'Canvas thumbnail'
        }
      ]
    })
    expect(view.status).toBe('ok')
    expect(view.sections).toContainEqual({
      kind: 'image',
      label: 'Image',
      dataUrl: 'data:image/png;base64,abcd',
      alt: 'Canvas thumbnail',
      width: 10,
      height: 10
    })
  })

  it('classifies malformed completed results as errors', () => {
    expect(canvasActivitySummarizers.draw({ drawn: 1 })).toMatchObject({ status: 'error' })
  })
})
