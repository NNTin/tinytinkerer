import { describe, expect, it } from 'vitest'
import { assignNodeIds, computeNodeId, hashContent } from '../src/index.js'

describe('computeNodeId', () => {
  it('returns the same id for the same (type, digest, occurrence)', () => {
    expect(computeNodeId('paragraph', 'hello world', 0)).toBe(
      computeNodeId('paragraph', 'hello world', 0)
    )
  })

  it('disambiguates identical digests by occurrence', () => {
    const first = computeNodeId('paragraph', 'hello', 0)
    const second = computeNodeId('paragraph', 'hello', 1)
    expect(first).not.toBe(second)
  })

  it('disambiguates identical digests by type', () => {
    expect(computeNodeId('paragraph', 'x', 0)).not.toBe(computeNodeId('heading', 'x', 0))
  })

  it('uses a hex-encoded djb2 digest', () => {
    expect(computeNodeId('codeBlock', 'console.log(1)', 0)).toBe(
      `codeBlock-${hashContent('console.log(1)')}-0`
    )
  })
})

describe('assignNodeIds', () => {
  it('fills missing ids deterministically for block and list item nodes', () => {
    const doc = assignNodeIds({
      nodes: [
        {
          type: 'list',
          ordered: false,
          children: [
            {
              type: 'listItem',
              children: [{ type: 'paragraph', children: [{ type: 'text', value: 'first' }] }]
            },
            {
              type: 'listItem',
              children: [{ type: 'paragraph', children: [{ type: 'text', value: 'first' }] }]
            }
          ]
        }
      ]
    })

    expect(doc.nodes[0]?.id).toMatch(/^list-/)
    expect(doc.nodes[0]?.type).toBe('list')
    if (doc.nodes[0]?.type !== 'list') {
      throw new Error('expected list node')
    }
    expect(doc.nodes[0].children[0]?.id).toMatch(/^listItem-/)
    expect(doc.nodes[0].children[1]?.id).toMatch(/^listItem-/)
    expect(doc.nodes[0].children[0]?.id).not.toBe(doc.nodes[0].children[1]?.id)
    expect(doc.nodes[0].children[0]?.children[0]?.id).toMatch(/^paragraph-/)
    if (doc.nodes[0].children[0]?.children[0]?.type !== 'paragraph') {
      throw new Error('expected paragraph node')
    }
    expect(doc.nodes[0].children[0].children[0].children[0]?.id).toMatch(/^text-/)
  })

  it('preserves caller-supplied ids while still normalizing nested children', () => {
    const doc = assignNodeIds({
      nodes: [
        {
          type: 'blockquote',
          id: 'quote-1',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: 'quoted' }]
            }
          ]
        }
      ]
    })

    expect(doc.nodes[0]?.id).toBe('quote-1')
    expect(doc.nodes[0]?.type).toBe('blockquote')
    if (doc.nodes[0]?.type !== 'blockquote') {
      throw new Error('expected blockquote node')
    }
    expect(doc.nodes[0].children[0]?.id).toMatch(/^paragraph-/)
  })

  it('keeps existing ids stable when the document is extended later', () => {
    const initial = assignNodeIds({
      nodes: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Intro' }]
        }
      ]
    })
    const extended = assignNodeIds({
      nodes: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Intro' }]
        },
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Tail' }]
        }
      ]
    })

    expect(initial.nodes[0]?.id).toBe(extended.nodes[0]?.id)
    expect(extended.nodes[1]?.id).toMatch(/^paragraph-/)
  })

  it('assigns deterministic ids to duplicate inline siblings', () => {
    const doc = assignNodeIds({
      nodes: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'same' },
            { type: 'text', value: 'same' }
          ]
        }
      ]
    })

    expect(doc.nodes[0]?.type).toBe('paragraph')
    if (doc.nodes[0]?.type !== 'paragraph') {
      throw new Error('expected paragraph node')
    }
    expect(doc.nodes[0].children[0]?.id).toMatch(/^text-/)
    expect(doc.nodes[0].children[1]?.id).toMatch(/^text-/)
    expect(doc.nodes[0].children[0]?.id).not.toBe(doc.nodes[0].children[1]?.id)
  })
})
