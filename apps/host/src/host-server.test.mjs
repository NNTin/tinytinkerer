// @ts-check

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHostServer } from './host-server.mjs'

/** @typedef {import('node:http').Server} HttpServer */

/** @type {Set<() => Promise<void>>} */
const activeClosers = new Set()

/** @type {Awaited<ReturnType<typeof createHostServer>> | null} */
let sharedHostServer = null

/**
 * @returns {Promise<HttpServer>}
 */
const startBlocker = async () =>
  new Promise((resolve, reject) => {
    const server = createHttpServer((_req, res) => {
      res.statusCode = 200
      res.end('blocked')
    })

    server.once('error', (error) => {
      reject(error instanceof Error ? error : new Error(String(error)))
    })
    server.listen(0, 'localhost', () => {
      activeClosers.add(() => closeServer(server))
      resolve(server)
    })
  })

/**
 * @returns {Promise<HttpServer>}
 */
const startEdgeStub = async () =>
  new Promise((resolve, reject) => {
    const server = createHttpServer((req, res) => {
      if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            auth: { state: 'ready', detail: 'GitHub auth available' },
            models: { state: 'ready', detail: 'Models ready' }
          })
        )
        return
      }

      res.statusCode = 404
      res.end('missing')
    })

    server.once('error', (error) => {
      reject(error instanceof Error ? error : new Error(String(error)))
    })
    // Bind to the IPv4 loopback explicitly (not 'localhost'). The vite proxy
    // below dials 127.0.0.1, so binding the stub to whatever 'localhost' resolves
    // to (often ::1 on dual-stack hosts) caused a deterministic
    // ECONNREFUSED 127.0.0.1 mismatch. Pinning both ends to the same family makes
    // the test independent of the host's resolver ordering.
    server.listen(0, '127.0.0.1', () => {
      activeClosers.add(() => closeServer(server))
      resolve(server)
    })
  })

/**
 * @param {number} backendPort
 * @returns {Promise<string>}
 */
const createTempHostRoot = async (backendPort) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tinytinkerer-host-test-'))
  activeClosers.add(() => rm(rootDir, { recursive: true, force: true }))

  const apps = [
    { name: 'web', mountPath: '/web/', proxyHealth: true },
    { name: 'mobile', mountPath: '/mobile/', proxyHealth: false },
    { name: 'widget', mountPath: '/widget/', proxyHealth: false },
    { name: 'canvas', mountPath: '/canvas/', proxyHealth: false },
    { name: 'excalidraw-app', mountPath: '/excalidraw-app/', proxyHealth: false }
  ]

  for (const app of apps) {
    const appRoot = join(rootDir, 'apps', app.name)
    await mkdir(join(appRoot, 'src'), { recursive: true })
    // Deliberately avoid `import { defineConfig } from 'vite'` here. These
    // configs are written into an OS temp dir that has no node_modules, so a
    // bare `vite` import is only resolvable when the ambient NODE_PATH happens
    // to expose vite (e.g. some local harnesses) — in a clean CI environment it
    // fails with "Cannot find module 'vite'". A plain object is a valid Vite
    // config and needs no module resolution. defineConfig is only an identity
    // helper for type inference, which a synthetic `.ts` fixture does not need.
    await writeFile(
      join(appRoot, 'vite.config.ts'),
      [
        'export default {',
        `  base: '${app.mountPath}',`,
        app.proxyHealth
          ? `  server: { proxy: { '/health': { target: 'http://127.0.0.1:${backendPort}', changeOrigin: true } } }`
          : '  server: {}',
        '}',
        ''
      ].join('\n')
    )
    await writeFile(
      join(appRoot, 'index.html'),
      [
        '<!doctype html>',
        '<html lang="en">',
        '  <head>',
        `    <title>${app.name}</title>`,
        '  </head>',
        '  <body>',
        '    <div id="root"></div>',
        '    <script type="module" src="/src/main.js"></script>',
        '  </body>',
        '</html>',
        ''
      ].join('\n')
    )
    await writeFile(join(appRoot, 'src/main.js'), `console.log('${app.name}')\n`)
  }

  await mkdir(join(rootDir, 'apps/host/public/__host'), { recursive: true })
  await writeFile(
    join(rootDir, 'apps/host/public/index.html'),
    '<!doctype html><html><head><title>host</title></head><body>host</body></html>\n'
  )
  await writeFile(join(rootDir, 'apps/host/public/__host/compositor.css'), 'body{}\n')
  await writeFile(join(rootDir, 'apps/host/public/__host/compositor.js'), 'console.log("host")\n')

  return rootDir
}

/**
 * @param {HttpServer} server
 * @returns {Promise<void>}
 */
const closeServer = async (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }

      resolve()
    })
  })

afterAll(async () => {
  await Promise.all(
    Array.from(activeClosers, async (close) => {
      activeClosers.delete(close)
      await close()
    })
  )
})

describe('host server', () => {
  beforeAll(async () => {
    sharedHostServer = await createHostServer({ port: 0, disableDependencyOptimization: true })
    activeClosers.add(() => sharedHostServer?.close() ?? Promise.resolve())
  })

  it('serves the composite host page from the root path', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const response = await fetch(`${sharedHostServer.url}/`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('<title>tinytinkerer host</title>')
    expect(body).toContain('src="./web/"')
    expect(body).toContain('src="./mobile/"')
    expect(body).toContain('src="./widget/?view=host"')
    expect(body).toContain('href="./canvas/"')
  })

  it('redirects non-suffixed app paths', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const webResponse = await fetch(`${sharedHostServer.url}/web`, { redirect: 'manual' })
    const widgetResponse = await fetch(`${sharedHostServer.url}/widget`, { redirect: 'manual' })
    const mobileResponse = await fetch(`${sharedHostServer.url}/mobile`, { redirect: 'manual' })
    const canvasResponse = await fetch(`${sharedHostServer.url}/canvas`, { redirect: 'manual' })
    const excalidrawResponse = await fetch(`${sharedHostServer.url}/excalidraw-app`, {
      redirect: 'manual'
    })

    expect(webResponse.status).toBe(301)
    expect(webResponse.headers.get('location')).toBe('/web/')
    expect(widgetResponse.status).toBe(301)
    expect(widgetResponse.headers.get('location')).toBe('/widget/')
    expect(mobileResponse.status).toBe(301)
    expect(mobileResponse.headers.get('location')).toBe('/mobile/')
    expect(canvasResponse.status).toBe(301)
    expect(canvasResponse.headers.get('location')).toBe('/canvas/')
    expect(excalidrawResponse.status).toBe(301)
    expect(excalidrawResponse.headers.get('location')).toBe('/excalidraw-app/')
  })

  it('serves the web app from /web/ with the web base path intact', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const response = await fetch(`${sharedHostServer.url}/web/`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('<title>web</title>')
    expect(body).toContain('src="/web/@vite/client"')
    expect(body).toContain('src="/web/src/main.tsx"')
  })

  it('serves mounted widget assets with the widget base path intact', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const response = await fetch(`${sharedHostServer.url}/widget/`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('src="/widget/@vite/client"')
    expect(body).toContain('src="/widget/src/main.tsx"')
  })

  it('serves the canvas shell and Excalidraw iframe app on separate mounts', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const canvasResponse = await fetch(`${sharedHostServer.url}/canvas/`)
    const canvasBody = await canvasResponse.text()
    const excalidrawResponse = await fetch(`${sharedHostServer.url}/excalidraw-app/`)
    const excalidrawBody = await excalidrawResponse.text()

    expect(canvasResponse.status).toBe(200)
    expect(canvasBody).toContain('src="/canvas/@vite/client"')
    expect(canvasBody).toContain('src="/canvas/src/main.tsx"')
    expect(excalidrawResponse.status).toBe(200)
    expect(excalidrawBody).toContain('src="/excalidraw-app/@vite/client"')
    expect(excalidrawBody).toContain('src="/excalidraw-app/src/main.tsx"')
  })

  it('serves the mobile manifest through the unified host', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const response = await fetch(`${sharedHostServer.url}/mobile/manifest.webmanifest`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/manifest+json')
    expect(body).toContain('"start_url":"./#/"')
  })

  it('proxies same-origin edge routes through the unified host', async () => {
    const edgeStub = await startEdgeStub()
    const edgeAddress = edgeStub.address()
    if (!edgeAddress || typeof edgeAddress === 'string') {
      throw new Error('Expected the edge stub to listen on a TCP address.')
    }

    const tempRoot = await createTempHostRoot(edgeAddress.port)
    const proxyHostServer = await createHostServer({
      rootDir: tempRoot,
      port: 0,
      disableDependencyOptimization: true
    })
    activeClosers.add(() => proxyHostServer.close())

    const response = await fetch(`${proxyHostServer.url}/health`)
    const body = /** @type {unknown} */ (await response.json())

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      auth: { state: 'ready' },
      models: { state: 'ready' }
    })
  }, 30_000)

  it('fails clearly when the preferred port is unavailable', async () => {
    const blocker = await startBlocker()
    const blockerAddress = blocker.address()
    if (!blockerAddress || typeof blockerAddress === 'string') {
      throw new Error('Expected blocker to listen on a TCP address.')
    }

    await expect(
      createHostServer({ preferredPort: blockerAddress.port, disableDependencyOptimization: true })
    ).rejects.toThrow(
      `Port ${blockerAddress.port} is already in use on localhost. Free the port and retry.`
    )
  })

  it('fails clearly when an explicitly requested port is unavailable', async () => {
    const blocker = await startBlocker()
    const blockerAddress = blocker.address()
    if (!blockerAddress || typeof blockerAddress === 'string') {
      throw new Error('Expected blocker to listen on a TCP address.')
    }

    await expect(
      createHostServer({ port: blockerAddress.port, disableDependencyOptimization: true })
    ).rejects.toThrow(
      `Port ${blockerAddress.port} is already in use on localhost. Free the port and retry.`
    )
  })
})
