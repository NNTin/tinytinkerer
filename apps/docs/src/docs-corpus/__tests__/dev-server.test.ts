import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

type Locator = {
  schemaVersion: number
  manifestHash: string
  manifestUrl: string
}

const activeChildren = new Set<ChildProcess>()

afterEach(() => {
  for (const child of activeChildren) child.kill('SIGTERM')
  activeChildren.clear()
})

const availablePort = async (): Promise<number> =>
  await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('could not allocate a development server port'))
        return
      }
      server.close(() => resolvePort(address.port))
    })
  })

const waitFor = async <Value>(
  read: () => Promise<Value | undefined>,
  timeoutMs = 45_000
): Promise<Value> => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (value !== undefined) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error('timed out waiting for Docusaurus development state', { cause: lastError })
}

const readLocator = async (siteDirectory: string): Promise<Locator | undefined> => {
  const globalData = JSON.parse(
    await readFile(join(siteDirectory, '.docusaurus/globalData.json'), 'utf8')
  ) as Record<string, { default?: Locator }>
  return globalData['documentation-corpus']?.default
}

describe('documentation corpus development assets', () => {
  it('serves lazy JSON and invalidates it after an authored source change', async () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url))
    const docsAppDirectory = resolve(testDirectory, '../../..')
    const pluginUrl = pathToFileURL(resolve(testDirectory, '../plugin.ts')).href
    const siteDirectory = await mkdtemp(join(tmpdir(), 'tinytinkerer-docs-dev-'))
    const docsDirectory = join(siteDirectory, 'docs')
    await symlink(join(docsAppDirectory, 'node_modules'), join(siteDirectory, 'node_modules'))
    await writeFile(
      join(siteDirectory, 'package.json'),
      '{"private":true,"type":"module"}\n',
      'utf8'
    )
    await writeFile(
      join(siteDirectory, 'docusaurus.config.ts'),
      `import { documentationCorpusPlugin } from ${JSON.stringify(pluginUrl)}
export default {
  title: 'Corpus fixture',
  url: 'https://example.test',
  baseUrl: '/base/',
  trailingSlash: true,
  plugins: [documentationCorpusPlugin],
  presets: [['classic', {blog: false, docs: {path: 'docs', routeBasePath: 'docs'}, theme: {customCss: undefined}}]]
}
`,
      'utf8'
    )
    await writeFile(join(siteDirectory, 'sidebars.ts'), 'export default {}\n', 'utf8')
    await mkdir(docsDirectory)
    await writeFile(
      join(docsDirectory, 'index.md'),
      '---\nid: home\nslug: /\nunlisted: true\n---\n# Home\n\nDirect only.\n',
      'utf8'
    )
    const guidePath = join(docsDirectory, 'guide.md')
    await writeFile(guidePath, '# Guide\n\nInitial content.\n', 'utf8')
    await writeFile(
      join(docsDirectory, 'draft.md'),
      '---\ndraft: true\n---\n# Draft\n\nNever emitted.\n',
      'utf8'
    )

    const port = await availablePort()
    const cli = resolve(docsAppDirectory, 'node_modules/@docusaurus/core/bin/docusaurus.mjs')
    const logs: string[] = []
    const child = spawn(
      process.execPath,
      [cli, 'start', '--host', '127.0.0.1', '--port', String(port), '--no-open'],
      {
        cwd: siteDirectory,
        env: { ...process.env, NODE_ENV: 'development', BROWSER: 'none' },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    activeChildren.add(child)
    child.stdout?.on('data', (chunk) => logs.push(String(chunk)))
    child.stderr?.on('data', (chunk) => logs.push(String(chunk)))
    child.once('exit', (code) => {
      if (code && code !== 0) logs.push(`Docusaurus exited with ${code}`)
    })

    const origin = `http://127.0.0.1:${port}`
    const firstLocator = await waitFor(async () => {
      const locator = await readLocator(siteDirectory)
      if (!locator) return undefined
      const response = await fetch(`${origin}${locator.manifestUrl}`)
      return response.ok ? locator : undefined
    }).catch((error: unknown) => {
      throw new Error(`${String(error)}\n${logs.join('')}`)
    })
    const manifestResponse = await fetch(`${origin}${firstLocator.manifestUrl}`)
    expect(manifestResponse.headers.get('content-type')).toContain('application/json')
    const firstManifest = (await manifestResponse.json()) as {
      schemaVersion: number
      documents: Array<{
        ref: string
        unlisted: boolean
        artifact: string
      }>
    }
    expect(firstManifest.schemaVersion).toBe(1)
    expect(firstManifest.documents.map(({ ref }) => ref).sort()).toEqual(['guide', 'home'])
    expect(firstManifest.documents.find(({ ref }) => ref === 'home')?.unlisted).toBe(true)
    expect(firstManifest.documents.some(({ ref }) => ref === 'draft')).toBe(false)

    const guideArtifact = firstManifest.documents.find(({ ref }) => ref === 'guide')?.artifact
    expect(guideArtifact).toBeDefined()
    const artifactResponse = await fetch(`${origin}${guideArtifact}`)
    expect(artifactResponse.headers.get('content-type')).toContain('application/json')
    const firstArtifact = (await artifactResponse.json()) as { markdown: string }
    expect(firstArtifact.markdown).toContain('Initial content.')

    await writeFile(guidePath, '# Guide\n\nChanged content.\n', 'utf8')
    const nextLocator = await waitFor(async () => {
      const locator = await readLocator(siteDirectory)
      return locator?.manifestHash !== firstLocator.manifestHash ? locator : undefined
    })
    const nextManifestResponse = await waitFor(async () => {
      const response = await fetch(`${origin}${nextLocator.manifestUrl}`)
      return response.headers.get('content-type')?.includes('application/json')
        ? response
        : undefined
    })
    expect(nextManifestResponse.headers.get('content-type')).toContain('application/json')
    const nextManifest = (await nextManifestResponse.json()) as typeof firstManifest
    const nextGuideArtifact = nextManifest.documents.find(({ ref }) => ref === 'guide')?.artifact
    expect(nextGuideArtifact).not.toBe(guideArtifact)
    const nextArtifactResponse = await fetch(`${origin}${nextGuideArtifact}`)
    const nextArtifact = (await nextArtifactResponse.json()) as { markdown: string }
    expect(nextArtifact.markdown).toContain('Changed content.')
  }, 60_000)
})
