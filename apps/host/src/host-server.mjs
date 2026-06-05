// @ts-check

import { createServer as createHttpServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { createServer as createViteServer } from 'vite'

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */
/** @typedef {import('node:http').Server} HttpServer */
/** @typedef {import('node:net').AddressInfo} AddressInfo */
/** @typedef {import('vite').ViteDevServer} ViteDevServer */
/** @typedef {import('vite').InlineConfig} InlineConfig */

/**
 * @typedef HostAppDefinition
 * @property {string} mountPath
 * @property {string} root
 * @property {ViteDevServer | undefined} [server]
 */

/**
 * @typedef HostServerOptions
 * @property {string | undefined} [host]
 * @property {number | undefined} [port]
 * @property {number | undefined} [preferredPort]
 * @property {string | undefined} [rootDir]
 * @property {boolean | undefined} [disableDependencyOptimization]
 */

const currentDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(currentDir, '../../..')

/**
 * @param {string} rootDir
 * @returns {HostAppDefinition[]}
 */
const createAppDefinitions = (rootDir) => [
  { mountPath: '/mobile/', root: join(rootDir, 'apps/mobile') },
  { mountPath: '/widget/', root: join(rootDir, 'apps/widget') },
  { mountPath: '/web/', root: join(rootDir, 'apps/web') }
]

const staticContentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
}

const edgeProxyPrefixes = ['/api', '/auth/github/exchange']

/**
 * @param {unknown} error
 * @returns {error is NodeJS.ErrnoException}
 */
const isPortInUseError = (error) =>
  error instanceof Error &&
  'code' in error &&
  error.code === 'EADDRINUSE'

/**
 * @param {HostAppDefinition} app
 * @returns {ViteDevServer}
 */
const getAppServer = (app) => {
  if (!app.server) {
    throw new Error(`Expected a Vite dev server for ${app.mountPath}.`)
  }

  return app.server
}

/**
 * @param {HttpServer} server
 * @param {string} host
 * @param {number} port
 * @returns {Promise<void>}
 */
const listen = async (server, host, port) =>
  new Promise((resolvePromise, rejectPromise) => {
    /** @param {Error} error */
    const handleError = (error) => {
      server.off('listening', handleListening)
      rejectPromise(error)
    }

    const handleListening = () => {
      server.off('error', handleError)
      resolvePromise()
    }

    server.once('error', handleError)
    server.once('listening', handleListening)
    server.listen(port, host)
  })

/**
 * @param {HttpServer} server
 * @returns {Promise<void>}
 */
const closeHttpServer = async (server) =>
  new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error instanceof Error ? error : new Error(String(error)))
        return
      }

      resolvePromise()
    })
  })

/**
 * @param {AddressInfo | null} addressInfo
 * @returns {string}
 */
const formatAddress = (addressInfo) => {
  if (!addressInfo) {
    throw new Error('Expected the host server to expose a TCP address.')
  }

  const host = addressInfo.address.includes(':') ? `[${addressInfo.address}]` : addressInfo.address
  return `http://${host}:${addressInfo.port}`
}

/**
 * @param {HostAppDefinition[]} apps
 * @param {string} pathname
 * @returns {HostAppDefinition | undefined}
 */
const findTargetApp = (apps, pathname) =>
  apps.find((app) => (app.mountPath === '/' ? true : pathname.startsWith(app.mountPath)))

/**
 * @param {string} pathname
 * @returns {boolean}
 */
const isEdgeProxyRequest = (pathname) =>
  pathname === '/health' ||
  edgeProxyPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

/**
 * @param {HostAppDefinition[]} apps
 * @returns {HostAppDefinition}
 */
const getEdgeProxyApp = (apps) => {
  const webApp = apps.find((app) => app.mountPath === '/web/')
  if (webApp) {
    return webApp
  }

  if (apps[0]) {
    return apps[0]
  }

  throw new Error('Expected at least one mounted app to proxy edge routes.')
}

/**
 * @param {string} publicDir
 * @param {string} pathname
 * @returns {string | undefined}
 */
const resolveHostStaticPath = (publicDir, pathname) => {
  if (pathname === '/' || pathname === '/index.html') {
    return join(publicDir, 'index.html')
  }

  if (!pathname.startsWith('/__host/')) {
    return undefined
  }

  const candidate = resolve(publicDir, `.${pathname}`)
  const rel = relative(publicDir, candidate)
  if (rel.startsWith('..') || rel === '') {
    return undefined
  }

  return candidate
}

/**
 * @param {string} publicDir
 * @param {string} pathname
 * @returns {Promise<{ body: Buffer, contentType: string } | undefined>}
 */
const readHostStaticAsset = async (publicDir, pathname) => {
  const assetPath = resolveHostStaticPath(publicDir, pathname)
  if (!assetPath) {
    return undefined
  }

  try {
    const body = await readFile(assetPath)
    const contentType = /** @type {Record<string, string>} */ (staticContentTypes)[extname(assetPath)] ?? 'application/octet-stream'
    return { body, contentType }
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const code = /** @type {string} */ (error.code)
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') {
        return undefined
      }
    }

    throw error
  }
}

/**
 * @param {HostAppDefinition[]} apps
 * @param {string} publicDir
 * @returns {(req: IncomingMessage, res: ServerResponse) => void}
 */
const createRequestHandler = (apps, publicDir) => (req, res) => {
  const handleRequest = async () => {
    const requestUrl = req.url ?? '/'
    const pathname = requestUrl.split('?')[0] ?? '/'

    if (pathname === '/mobile' || pathname === '/widget' || pathname === '/web') {
      res.statusCode = 301
      res.setHeader(
        'Location',
        pathname === '/mobile'
          ? '/mobile/'
          : pathname === '/widget'
            ? '/widget/'
            : '/web/'
      )
      res.end()
      return
    }

    if (isEdgeProxyRequest(pathname)) {
      getAppServer(getEdgeProxyApp(apps)).middlewares(req, res, () => {
        res.statusCode = 404
        res.end('Not found')
      })
      return
    }

    const staticAsset = await readHostStaticAsset(publicDir, pathname)
    if (staticAsset) {
      res.statusCode = 200
      res.setHeader('Content-Type', staticAsset.contentType)
      res.end(staticAsset.body)
      return
    }

    const target = findTargetApp(apps, pathname)
    if (!target) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    getAppServer(target).middlewares(req, res, () => {
      res.statusCode = 404
      res.end('Not found')
    })
  }

  void handleRequest().catch((error) => {
    // Log the real error server-side; never reflect exception text back to the
    // client, where it could be interpreted as HTML (CodeQL js/xss-through-exception).
    console.error('Unhandled error while handling request.', error)
    res.statusCode = 500
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Internal server error')
  })
}

/**
 * @param {string} host
 * @param {number} port
 * @returns {Promise<void>}
 */
const probePort = async (host, port) =>
  new Promise((resolvePromise, rejectPromise) => {
    const probe = createHttpServer()
    probe.once('error', (error) => rejectPromise(error))
    probe.once('listening', () => probe.close(() => resolvePromise()))
    probe.listen(port, host)
  })

/**
 * @param {HttpServer} server
 * @param {{ host: string, port: number | undefined, preferredPort: number }} options
 * @returns {Promise<void>}
 */
const startListening = async (server, { host, port, preferredPort }) => {
  const targetPort = port ?? preferredPort
  try {
    await listen(server, host, targetPort)
  } catch (error) {
    if (isPortInUseError(error)) {
      throw new Error(
        `Port ${targetPort} is already in use on ${host}. Free the port and retry.`,
        { cause: error }
      )
    }

    throw error
  }
}

/**
 * @param {HostServerOptions} [options]
 * @returns {Promise<{
 *   apps: HostAppDefinition[],
 *   close: () => Promise<void>,
 *   host: string,
 *   port: number,
 *   preferredPort: number,
 *   server: HttpServer,
 *   url: string
 * }>}
 */
export const createHostServer = async ({
  host = 'localhost',
  port,
  preferredPort = 3111,
  rootDir = workspaceRoot,
  disableDependencyOptimization = false
} = {}) => {
  const targetPort = port ?? preferredPort

  try {
    await probePort(host, targetPort)
  } catch (error) {
    if (isPortInUseError(error)) {
      throw new Error(
        `Port ${targetPort} is already in use on ${host}. Free the port and retry.`,
        { cause: error }
      )
    }
    throw error
  }

  const apps = createAppDefinitions(rootDir)
  const publicDir = join(rootDir, 'apps/host/public')
  const httpServer = createHttpServer()

  try {
    for (const app of apps) {
      /** @type {InlineConfig} */
      const viteConfig = {
        root: app.root,
        configFile: join(app.root, 'vite.config.ts'),
        server: {
          middlewareMode: true,
          hmr: { server: httpServer }
        }
      }

      if (disableDependencyOptimization) {
        viteConfig.optimizeDeps = { noDiscovery: true }
      }

      app.server = await createViteServer(viteConfig)
    }

    httpServer.on('request', createRequestHandler(apps, publicDir))

    await startListening(httpServer, { host, port, preferredPort })
  } catch (error) {
    // Only tear down the servers that were actually created. Routing the
    // partially-initialized apps through getAppServer() here would throw on the
    // first app whose server never started, masking the original failure.
    await Promise.allSettled(
      apps
        .filter((app) => app.server)
        .map((app) => /** @type {ViteDevServer} */ (app.server).close())
    )

    if (httpServer.listening) {
      await closeHttpServer(httpServer)
    }

    throw error
  }

  let closed = false

  const close = async () => {
    if (closed) {
      return
    }

    closed = true
    await Promise.all(apps.map((app) => getAppServer(app).close()))
    await closeHttpServer(httpServer)
  }

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected the host server to expose a TCP address.')
  }

  return {
    apps,
    close,
    host,
    port: address.port,
    preferredPort,
    server: httpServer,
    url: formatAddress(address)
  }
}

/**
 * @param {{ host?: string, preferredPort?: number }} [options]
 * @returns {Promise<void>}
 */
export const runHostServer = async ({
  host = 'localhost',
  preferredPort = 3111
} = {}) => {
  const hostServer = await createHostServer({ host, preferredPort })

  console.log(`@tinytinkerer/host listening at ${hostServer.url}`)
  console.log(`  Composite: ${hostServer.url}/`)
  console.log(`  Web: ${hostServer.url}/web/`)
  console.log(`  Widget: ${hostServer.url}/widget/`)
  console.log(`  Mobile: ${hostServer.url}/mobile/`)

  const shutdown = async () => {
    try {
      await hostServer.close()
      process.exit(0)
    } catch (error) {
      console.error('Failed to shut down @tinytinkerer/host cleanly.', error)
      process.exit(1)
    }
  }

  process.once('SIGINT', () => {
    void shutdown()
  })
  process.once('SIGTERM', () => {
    void shutdown()
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runHostServer()
}
