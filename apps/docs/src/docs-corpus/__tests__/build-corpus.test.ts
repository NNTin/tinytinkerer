import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  generateDocumentationCorpus,
  writeDocumentationCorpus,
  type DocumentationCorpusSource
} from '../build-corpus'

const source = (
  id: string,
  absoluteSourcePath: string,
  overrides: Partial<DocumentationCorpusSource> = {}
): DocumentationCorpusSource => ({
  id,
  version: 'current',
  versionPath: '/docs/',
  isLast: true,
  title: `Title ${id}`,
  permalink: `/docs/${id}/`,
  source: `@site/../../docs/${id}.md`,
  draft: false,
  unlisted: false,
  absoluteSourcePath,
  ...overrides
})

describe('documentation corpus generation', () => {
  it('includes unlisted documents, excludes drafts, and resolves refs by Docusaurus id', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tinytinkerer-corpus-'))
    const visiblePath = join(directory, 'visible.md')
    const unlistedPath = join(directory, 'unlisted.mdx')
    await writeFile(visiblePath, '# Visible\n\nReadable.\n', 'utf8')
    await writeFile(unlistedPath, '# Direct only\n\nStill readable.\n', 'utf8')

    const corpus = await generateDocumentationCorpus(
      [
        source('visible-id', visiblePath),
        source('direct-id', unlistedPath, { unlisted: true }),
        // A missing draft path proves the source is not read at all.
        source('draft-id', join(directory, 'missing-draft.md'), { draft: true })
      ],
      '/docs/assets/docs-corpus'
    )

    expect(corpus.manifest.documents.map((entry) => entry.ref)).toEqual(['direct-id', 'visible-id'])
    expect(corpus.manifest.documents[0]).toMatchObject({
      ref: 'direct-id',
      unlisted: true,
      permalink: '/docs/direct-id/'
    })
    expect(corpus.manifest.documents.some((entry) => entry.ref === 'draft-id')).toBe(false)
  })

  it('content-addresses artifacts independently and writes only lazy JSON assets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tinytinkerer-corpus-'))
    const output = join(directory, 'build')
    const firstPath = join(directory, 'first.md')
    const secondPath = join(directory, 'second.md')
    await writeFile(firstPath, '# First\n\nVersion one.\n', 'utf8')
    await writeFile(secondPath, '# Second\n\nUnchanged.\n', 'utf8')
    const sources = [source('first', firstPath), source('second', secondPath)]

    const before = await generateDocumentationCorpus(sources, '/assets/docs-corpus')
    await writeFile(firstPath, '# First\n\nVersion two.\n', 'utf8')
    const after = await generateDocumentationCorpus(sources, '/assets/docs-corpus')

    const beforeFirst = before.manifest.documents.find((entry) => entry.ref === 'first')
    const beforeSecond = before.manifest.documents.find((entry) => entry.ref === 'second')
    const afterFirst = after.manifest.documents.find((entry) => entry.ref === 'first')
    const afterSecond = after.manifest.documents.find((entry) => entry.ref === 'second')
    expect(afterFirst?.contentHash).not.toBe(beforeFirst?.contentHash)
    expect(afterFirst?.artifact).not.toBe(beforeFirst?.artifact)
    expect(afterSecond?.contentHash).toBe(beforeSecond?.contentHash)
    expect(afterSecond?.artifact).toBe(beforeSecond?.artifact)
    expect(after.manifest.manifestHash).not.toBe(before.manifest.manifestHash)

    await writeDocumentationCorpus(output, after)
    const manifest = JSON.parse(
      await readFile(join(output, 'assets/docs-corpus', after.manifestFileName), 'utf8')
    ) as { documents: Array<{ artifact: string; artifactHash: string }> }
    expect(manifest.documents).toHaveLength(2)
    for (const entry of manifest.documents) {
      const relative = entry.artifact.replace('/assets/docs-corpus/', '')
      const serializedArtifact = await readFile(
        join(output, 'assets/docs-corpus', relative),
        'utf8'
      )
      expect(createHash('sha256').update(serializedArtifact).digest('hex')).toBe(entry.artifactHash)
      const artifact = JSON.parse(serializedArtifact) as {
        markdown: string
        sections: unknown[]
      }
      expect(artifact.markdown).toBeTruthy()
      expect(artifact.sections.length).toBeGreaterThan(1)
    }
  })

  it('changes the artifact URL for metadata-only changes without invalidating other documents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tinytinkerer-corpus-'))
    const changedPath = join(directory, 'changed.md')
    const stablePath = join(directory, 'stable.md')
    await writeFile(changedPath, '# Authored heading\n\nUnchanged body.\n', 'utf8')
    await writeFile(stablePath, '# Stable\n\nStill stable.\n', 'utf8')

    const before = await generateDocumentationCorpus(
      [source('changed', changedPath, { title: 'Old title' }), source('stable', stablePath)],
      '/assets/docs-corpus'
    )
    const after = await generateDocumentationCorpus(
      [source('changed', changedPath, { title: 'New title' }), source('stable', stablePath)],
      '/assets/docs-corpus'
    )
    const beforeChanged = before.manifest.documents.find((entry) => entry.ref === 'changed')
    const afterChanged = after.manifest.documents.find((entry) => entry.ref === 'changed')
    const beforeStable = before.manifest.documents.find((entry) => entry.ref === 'stable')
    const afterStable = after.manifest.documents.find((entry) => entry.ref === 'stable')

    expect(afterChanged?.contentHash).toBe(beforeChanged?.contentHash)
    expect(afterChanged?.artifactHash).not.toBe(beforeChanged?.artifactHash)
    expect(afterChanged?.artifact).not.toBe(beforeChanged?.artifact)
    expect(after.manifest.manifestHash).not.toBe(before.manifest.manifestHash)
    expect(afterStable).toEqual(beforeStable)
  })

  it('allows refs across versions but rejects duplicate version-qualified identities', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tinytinkerer-corpus-'))
    const path = join(directory, 'same.md')
    await writeFile(path, '# Same\n', 'utf8')

    await expect(
      generateDocumentationCorpus(
        [source('same', path), source('same', path)],
        '/assets/docs-corpus'
      )
    ).rejects.toThrow('duplicate Docusaurus identity')

    await expect(
      generateDocumentationCorpus(
        [
          source('same', path),
          source('same', path, {
            version: '1.0',
            versionPath: '/docs/1.0/',
            isLast: false
          })
        ],
        '/assets/docs-corpus'
      )
    ).resolves.toMatchObject({
      manifest: {
        documents: [
          { ref: 'same', version: '1.0', isLast: false },
          { ref: 'same', version: 'current', isLast: true }
        ]
      }
    })
  })
})
