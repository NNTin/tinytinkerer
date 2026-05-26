import { describe, expect, it } from 'vitest'
import { computeNodeId, hashContent } from '../src/index.js'

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
