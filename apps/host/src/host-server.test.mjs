// @ts-check

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer as createHttpServer } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DOCS_SITE_SPEC, HOSTED_APP_SPECS } from './app-definitions.mjs'
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
 * @returns {Promise<HttpServer>}
 */
const startDocsStub = async () =>
  new Promise((resolve, reject) => {
    const server = createHttpServer((req, res) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('X-Docs-Proxy', 'ready')
      res.end(`docs:${req.url}`)
    })

    server.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key']
      if (!key) {
        socket.destroy()
        return
      }
      const accept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64')
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '',
          ''
        ].join('\r\n')
      )
      // Keep the upgraded connection alive like webpack-dev-server and send a
      // frame after the browser disconnects. The host proxy must close the
      // upstream half instead of crashing with an unhandled EPIPE.
      setTimeout(() => {
        if (!socket.destroyed) {
          socket.end(Buffer.from([0x81, 0x02, 0x6f, 0x6b]))
        }
      }, 25)
    })

    server.once('error', (error) => {
      reject(error instanceof Error ? error : new Error(String(error)))
    })
    server.listen(0, '127.0.0.1', () => {
      activeClosers.add(() => closeServer(server))
      resolve(server)
    })
  })

/**
 * @param {string} hostUrl
 * @returns {Promise<string>}
 */
const requestDocsWebSocketUpgrade = async (hostUrl) =>
  new Promise((resolve, reject) => {
    const url = new URL(hostUrl)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const socket = connect(Number(url.port), hostname)
    let response = ''
    socket.setEncoding('utf8')
    socket.once('error', reject)
    socket.on('data', (chunk) => {
      response += String(chunk)
      if (response.includes('\r\n\r\n')) {
        socket.destroy()
        resolve(response)
      }
    })
    socket.once('connect', () => {
      socket.write(
        [
          `GET ${DOCS_SITE_SPEC.webSocketPath} HTTP/1.1`,
          `Host: ${url.host}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          '',
          ''
        ].join('\r\n')
      )
    })
  })

/**
 * @param {number} backendPort
 * @returns {Promise<string>}
 */
const createTempHostRoot = async (backendPort) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tinytinkerer-host-test-'))
  activeClosers.add(() => rm(rootDir, { recursive: true, force: true }))

  // Fixture apps live under apps/<source>. web/widget/mobile share the single
  // `shell` source, so we write one fixture per unique source. The edge proxy prefers
  // the /web/ mount, so the shell source carries the /health proxy.
  /** @type {Map<string, { name: string, proxyHealth: boolean }>} */
  const sources = new Map()
  for (const { source, slug } of HOSTED_APP_SPECS) {
    const entry = sources.get(source) ?? { name: source, proxyHealth: false }
    if (slug === 'web') {
      entry.proxyHealth = true
    }
    sources.set(source, entry)
  }

  for (const app of sources.values()) {
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
        // The host server overrides base per mount path, so the fixture base is
        // irrelevant; a valid value keeps Vite happy.
        `  base: '/',`,
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
  it('keeps the host app inventory unique and canonical', () => {
    expect(new Set(HOSTED_APP_SPECS.map(({ slug }) => slug)).size).toBe(HOSTED_APP_SPECS.length)
    expect(new Set(HOSTED_APP_SPECS.map(({ mountPath }) => mountPath)).size).toBe(
      HOSTED_APP_SPECS.length
    )
    expect(new Set(HOSTED_APP_SPECS.map(({ label }) => label)).size).toBe(HOSTED_APP_SPECS.length)
    for (const { slug, label, mountPath } of HOSTED_APP_SPECS) {
      expect(label.trim()).not.toBe('')
      // The root composition app mounts at '/'; every other shell at '/<slug>/'.
      expect(mountPath).toBe(slug === 'host' ? '/' : `/${slug}/`)
    }
  })

  beforeAll(async () => {
    const docsStub = await startDocsStub()
    const docsAddress = docsStub.address()
    if (!docsAddress || typeof docsAddress === 'string') {
      throw new Error('Expected the docs stub to listen on a TCP address.')
    }
    sharedHostServer = await createHostServer({
      port: 0,
      disableDependencyOptimization: true,
      docsDevOrigin: `http://127.0.0.1:${docsAddress.port}`
    })
    activeClosers.add(() => sharedHostServer?.close() ?? Promise.resolve())
  })

  it('serves the single-document root app (no iframes) from the root path', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const response = await fetch(`${sharedHostServer.url}/`)
    const body = await response.text()

    expect(response.status).toBe(200)
    // The root is now a real Vite React app at base '/', not a static iframe page.
    expect(body).toContain('<div id="root"')
    expect(body).toContain('src="/@vite/client"')
    expect(body).toContain('src="/src/main.tsx"')
    expect(body).not.toContain('<iframe')
  })

  it('redirects non-suffixed app paths', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const webResponse = await fetch(`${sharedHostServer.url}/web`, { redirect: 'manual' })
    const widgetResponse = await fetch(`${sharedHostServer.url}/widget`, { redirect: 'manual' })
    const mobileResponse = await fetch(`${sharedHostServer.url}/mobile`, { redirect: 'manual' })
    const canvasResponse = await fetch(`${sharedHostServer.url}/canvas`, { redirect: 'manual' })
    const pixelAgentsResponse = await fetch(`${sharedHostServer.url}/pixel-agents`, {
      redirect: 'manual'
    })
    const docsResponse = await fetch(`${sharedHostServer.url}/docs`, { redirect: 'manual' })

    expect(webResponse.status).toBe(301)
    expect(webResponse.headers.get('location')).toBe('/web/')
    expect(widgetResponse.status).toBe(301)
    expect(widgetResponse.headers.get('location')).toBe('/widget/')
    expect(mobileResponse.status).toBe(301)
    expect(mobileResponse.headers.get('location')).toBe('/mobile/')
    expect(canvasResponse.status).toBe(301)
    expect(canvasResponse.headers.get('location')).toBe('/canvas/')
    expect(pixelAgentsResponse.status).toBe(301)
    expect(pixelAgentsResponse.headers.get('location')).toBe('/pixel-agents/')
    expect(docsResponse.status).toBe(301)
    expect(docsResponse.headers.get('location')).toBe('/docs/')
  })

  it('proxies documentation roots and deep links through the unified host', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const rootResponse = await fetch(`${sharedHostServer.url}/docs/`)
    const deepResponse = await fetch(`${sharedHostServer.url}/docs/ARCHITECTURE/?section=layers`)

    expect(rootResponse.status).toBe(200)
    expect(rootResponse.headers.get('x-docs-proxy')).toBe('ready')
    await expect(rootResponse.text()).resolves.toBe('docs:/docs/')
    expect(deepResponse.status).toBe(200)
    await expect(deepResponse.text()).resolves.toBe('docs:/docs/ARCHITECTURE/?section=layers')
  })

  it('proxies the Docusaurus development websocket through the unified host', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const response = await requestDocsWebSocketUpgrade(sharedHostServer.url)

    expect(response).toContain('HTTP/1.1 101 Switching Protocols')
    expect(response.toLowerCase()).toContain('upgrade: websocket')
  })

  it('serves the shell from /web/ with the web base path intact', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const response = await fetch(`${sharedHostServer.url}/web/`)
    const body = await response.text()

    expect(response.status).toBe(200)
    // The single shell serves every browser endpoint; its title is the shared brand.
    expect(body).toContain('<title>tinytinkerer</title>')
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

  it('serves the integrated canvas application inside the canvas mount', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const canvasResponse = await fetch(`${sharedHostServer.url}/canvas/`)
    const canvasBody = await canvasResponse.text()

    expect(canvasResponse.status).toBe(200)
    expect(canvasBody).toContain('<title>tinytinkerer canvas</title>')
    expect(canvasBody).toContain('src="/canvas/@vite/client"')
    expect(canvasBody).toContain('src="/canvas/src/main.tsx"')
  })

  it('serves the integrated Pixel Agents application inside its mount', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const response = await fetch(`${sharedHostServer.url}/pixel-agents/`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('<title>tinytinkerer pixel agents</title>')
    expect(body).toContain('src="/pixel-agents/@vite/client"')
    expect(body).toContain('src="/pixel-agents/src/main.tsx"')
    // The sandboxed office iframe fetches its module entry and fonts with
    // `Origin: null`; the mount's dev server must answer with ACAO '*'.
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
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
