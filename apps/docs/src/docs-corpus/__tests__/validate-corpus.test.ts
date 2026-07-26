import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { generateDocumentationCorpus, writeDocumentationCorpus } from '../build-corpus'
import {
  validateDocumentationCorpusInvariants,
  validateNoHiddenAuthorComments,
  validateProductionDocumentationCorpus
} from '../validate-corpus'

describe('documentation corpus validation', () => {
  it('validates artifact invariants and production anchor/canonical parity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tinytinkerer-corpus-validation-'))
    const sourcePath = join(directory, 'guide.md')
    const output = join(directory, 'build')
    await writeFile(sourcePath, '# Guide\n\n## Addressable\n\nReadable.\n', 'utf8')
    const corpus = await generateDocumentationCorpus(
      [
        {
          id: 'guide',
          version: 'current',
          versionPath: '/base/docs/',
          isLast: true,
          title: 'Guide',
          permalink: '/base/docs/guide/',
          source: '@site/docs/guide.md',
          draft: false,
          unlisted: false,
          absoluteSourcePath: sourcePath
        }
      ],
      '/base/assets/docs-corpus'
    )

    expect(() =>
      validateDocumentationCorpusInvariants(corpus, {
        baseUrl: '/base/',
        trailingSlash: true
      })
    ).not.toThrow()

    await writeDocumentationCorpus(output, corpus)
    await mkdir(join(output, 'docs/guide'), { recursive: true })
    await writeFile(
      join(output, 'docs/guide/index.html'),
      '<!doctype html><link rel="canonical" href="https://example.test/base/docs/guide/"><h1>Guide</h1><h2 id="addressable">Addressable</h2>',
      'utf8'
    )
    await expect(
      validateProductionDocumentationCorpus(output, corpus, {
        baseUrl: '/base/',
        trailingSlash: true,
        siteUrl: 'https://example.test'
      })
    ).resolves.toBeUndefined()

    await writeFile(
      join(output, 'docs/guide/index.html'),
      '<!doctype html><link rel="canonical" href="https://example.test/base/docs/guide/"><h2>Addressable</h2>',
      'utf8'
    )
    await expect(
      validateProductionDocumentationCorpus(output, corpus, {
        baseUrl: '/base/',
        trailingSlash: true,
        siteUrl: 'https://example.test'
      })
    ).rejects.toThrow('anchor addressable does not exist in built HTML')

    const manifestBytes = await readFile(
      join(output, 'assets/docs-corpus', corpus.manifestFileName),
      'utf8'
    )
    expect(JSON.parse(manifestBytes)).toEqual(corpus.manifest)

    const invalidPermalink = structuredClone(corpus)
    invalidPermalink.manifest.documents[0].permalink = '/base/docs/guide'
    expect(() =>
      validateDocumentationCorpusInvariants(invalidPermalink, {
        baseUrl: '/base/',
        trailingSlash: true
      })
    ).toThrow('non-canonical permalink')

    const invalidOffsets = structuredClone(corpus)
    const invalidOffsetArtifact = [...invalidOffsets.artifacts.values()][0]
    invalidOffsetArtifact.sections[2].endOffset = Number.MAX_SAFE_INTEGER
    invalidOffsets.manifest.documents[0].artifactHash = createHash('sha256')
      .update(`${JSON.stringify(invalidOffsetArtifact)}\n`)
      .digest('hex')
    expect(() =>
      validateDocumentationCorpusInvariants(invalidOffsets, {
        baseUrl: '/base/',
        trailingSlash: true
      })
    ).toThrow('invalid offsets')

    const duplicateAnchor = structuredClone(corpus)
    const duplicateAnchorArtifact = [...duplicateAnchor.artifacts.values()][0]
    duplicateAnchorArtifact.sections[1].anchor = 'addressable'
    duplicateAnchor.manifest.documents[0].artifactHash = createHash('sha256')
      .update(`${JSON.stringify(duplicateAnchorArtifact)}\n`)
      .digest('hex')
    expect(() =>
      validateDocumentationCorpusInvariants(duplicateAnchor, {
        baseUrl: '/base/',
        trailingSlash: true
      })
    ).toThrow('duplicate anchor addressable')

    const invalidHash = structuredClone(corpus)
    invalidHash.manifest.documents[0].artifactHash = '0'.repeat(64)
    expect(() =>
      validateDocumentationCorpusInvariants(invalidHash, {
        baseUrl: '/base/',
        trailingSlash: true
      })
    ).toThrow('artifactHash does not match')

    expect(() =>
      validateNoHiddenAuthorComments(
        'hidden',
        '# Visible\n\n<!-- editorial -->\n\n`<!-- rendered code -->`\n'
      )
    ).toThrow('hidden author comment')
    expect(() =>
      validateNoHiddenAuthorComments(
        'visible-code',
        '# Visible\n\n```md\n<!-- rendered code -->\n```\n'
      )
    ).not.toThrow()
  })
})
import { createHash } from 'node:crypto'
