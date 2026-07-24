// @ts-check

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DOCS_SITE_SPEC, HOSTED_APP_SPECS } from './app-definitions.mjs'
import { composeFrontend } from './build-pages.mjs'

/** @type {string[]} */
const tempRoots = []

/**
 * @param {string} path
 * @param {string} content
 */
const writeFixture = async (path, content) => {
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'index.html'), content)
}

const createWorkspaceFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'tinytinkerer-build-pages-test-'))
  tempRoots.push(root)

  await writeFixture(join(root, 'apps/host/dist-root'), 'host root')
  for (const source of new Set(
    HOSTED_APP_SPECS.filter(({ slug }) => slug !== 'host').map(({ source }) => source)
  )) {
    await writeFixture(join(root, 'apps', source, 'dist'), `${source} app`)
  }
  await writeFixture(
    join(root, 'apps', DOCS_SITE_SPEC.source, DOCS_SITE_SPEC.outputDir),
    'documentation site'
  )
  await writeFixture(
    join(root, 'apps', DOCS_SITE_SPEC.source, DOCS_SITE_SPEC.outputDir, 'ARCHITECTURE'),
    'nested documentation page'
  )
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('frontend build composition', () => {
  it('places the Docusaurus output under the existing host dist directory', async () => {
    const workspaceRoot = await createWorkspaceFixture()

    const result = await composeFrontend({ workspaceRoot })

    await expect(readFile(join(result.hostDistDir, 'index.html'), 'utf8')).resolves.toBe(
      'host root'
    )
    await expect(
      readFile(join(result.hostDistDir, DOCS_SITE_SPEC.slug, 'index.html'), 'utf8')
    ).resolves.toBe('documentation site')
    await expect(
      readFile(join(result.hostDistDir, DOCS_SITE_SPEC.slug, 'ARCHITECTURE', 'index.html'), 'utf8')
    ).resolves.toBe('nested documentation page')
    for (const { slug, source } of HOSTED_APP_SPECS.filter(({ slug }) => slug !== 'host')) {
      await expect(readFile(join(result.hostDistDir, slug, 'index.html'), 'utf8')).resolves.toBe(
        `${source} app`
      )
    }
  })
})
