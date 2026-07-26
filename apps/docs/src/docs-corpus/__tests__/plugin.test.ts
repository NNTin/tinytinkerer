import { describe, expect, it } from 'vitest'
import { createDocumentationCorpusSources, selectCanonicalCorpusVersion } from '../plugin'

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

describe('createDocumentationCorpusSources', () => {
  it('keeps every version, canonicalizes routes, and uses authored visibility', () => {
    const versions = [
      {
        versionName: 'current',
        path: '/base/docs',
        isLast: true,
        docs: [
          {
            id: 'index',
            title: 'Docs',
            permalink: '/base/docs',
            source: '@site/docs/index.mdx',
            frontMatter: { unlisted: true }
          },
          {
            id: 'guide',
            title: 'Guide',
            permalink: '/base/docs/guide',
            source: '@site/docs/guide.md',
            frontMatter: { draft: true }
          }
        ]
      },
      {
        versionName: '1.0',
        path: '/base/docs/1.0',
        isLast: false,
        docs: [
          {
            id: 'guide',
            title: 'Old guide',
            permalink: '/base/docs/1.0/guide',
            source: '@site/versioned_docs/version-1.0/guide.md',
            frontMatter: { unlisted: true }
          }
        ]
      }
    ]

    expect(
      createDocumentationCorpusSources(versions, {
        siteDir: '/site',
        baseUrl: '/base/',
        trailingSlash: true
      })
    ).toEqual([
      expect.objectContaining({
        id: 'index',
        version: 'current',
        versionPath: '/base/docs/',
        permalink: '/base/docs/',
        isLast: true,
        draft: false,
        unlisted: true
      }),
      expect.objectContaining({
        id: 'guide',
        version: 'current',
        permalink: '/base/docs/guide/',
        draft: true,
        unlisted: false
      }),
      expect.objectContaining({
        id: 'guide',
        version: '1.0',
        versionPath: '/base/docs/1.0/',
        permalink: '/base/docs/1.0/guide/',
        isLast: false,
        unlisted: true
      })
    ])

    expect(
      createDocumentationCorpusSources([versions[0]], {
        siteDir: '/site',
        baseUrl: '/base/',
        trailingSlash: false
      }).map(({ permalink, versionPath }) => ({ permalink, versionPath }))
    ).toEqual([
      { permalink: '/base/docs', versionPath: '/base/docs' },
      { permalink: '/base/docs/guide', versionPath: '/base/docs' }
    ])
  })
})
