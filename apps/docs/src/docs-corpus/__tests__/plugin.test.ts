import { describe, expect, it } from 'vitest'
import { selectCanonicalCorpusVersion } from '../plugin'

describe('selectCanonicalCorpusVersion', () => {
  it('selects only the canonical served version when ids repeat across versions', () => {
    const versions = [
      {
        versionName: 'current',
        isLast: false,
        docs: [{ id: 'guide', permalink: '/docs/next/guide' }]
      },
      {
        versionName: '2.0',
        isLast: true,
        docs: [{ id: 'guide', permalink: '/docs/guide' }]
      },
      {
        versionName: '1.0',
        isLast: false,
        docs: [{ id: 'guide', permalink: '/docs/1.0/guide' }]
      }
    ]

    expect(selectCanonicalCorpusVersion(versions)).toEqual(versions[1])
  })

  it('rejects missing or ambiguous canonical-version metadata', () => {
    expect(() => selectCanonicalCorpusVersion([{ versionName: 'current', isLast: false }])).toThrow(
      'exactly one Docusaurus isLast version'
    )
    expect(() =>
      selectCanonicalCorpusVersion([
        { versionName: '2.0', isLast: true },
        { versionName: '1.0', isLast: true }
      ])
    ).toThrow('exactly one Docusaurus isLast version')
  })
})
