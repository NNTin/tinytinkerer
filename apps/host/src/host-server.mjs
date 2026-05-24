// @ts-check

import { createServer as createHttpServer } from 'node:http'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
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
  { mountPath: '/', root: join(rootDir, 'apps/web') }
]

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

  return `http://${addressInfo.address}:${addressInfo.port}`
}

/**
 * @param {HostAppDefinition[]} apps
 * @param {string} pathname
 * @returns {HostAppDefinition | undefined}
 */
const findTargetApp = (apps, pathname) =>
  apps.find((app) => (app.mountPath === '/' ? true : pathname.startsWith(app.mountPath)))

/**
 * @param {HostAppDefinition[]} apps
 * @returns {(req: IncomingMessage, res: ServerResponse) => void}
 */
const createRequestHandler = (apps) => (req, res) => {
  const requestUrl = req.url ?? '/'
  const pathname = requestUrl.split('?')[0] ?? '/'

  if (pathname === '/mobile' || pathname === '/widget') {
    res.statusCode = 301
    res.setHeader('Location', pathname === '/mobile' ? '/mobile/' : '/widget/')
    res.end()
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

/**
 * @param {HttpServer} server
 * @param {{ host: string, port: number | undefined, preferredPort: number }} options
 * @returns {Promise<void>}
 */
const startListening = async (server, { host, port, preferredPort }) => {
  if (port !== undefined) {
    try {
      await listen(server, host, port)
      return
    } catch (error) {
      if (isPortInUseError(error)) {
        throw new Error(
          `Port ${port} is already in use on ${host}. Set PORT to an open port and retry.`,
          { cause: error }
        )
      }

      throw error
    }
  }

  try {
    await listen(server, host, preferredPort)
    return
  } catch (error) {
    if (!isPortInUseError(error)) {
      throw error
    }
  }

  await listen(server, host, 0)
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
  host = '127.0.0.1',
  port,
  preferredPort = 3000,
  rootDir = workspaceRoot,
  disableDependencyOptimization = false
} = {}) => {
  const apps = createAppDefinitions(rootDir)
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

    httpServer.on('request', createRequestHandler(apps))

    await startListening(httpServer, { host, port, preferredPort })
  } catch (error) {
    await Promise.allSettled(
      apps
        .map((app) => getAppServer(app))
        .map((server) => server.close())
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
 * @param {{ host?: string, port?: number, preferredPort?: number }} [options]
 * @returns {Promise<void>}
 */
export const runHostServer = async ({
  host = '127.0.0.1',
  port = process.env.PORT ? Number(process.env.PORT) : undefined,
  preferredPort = 3000
} = {}) => {
  const hostServer = await createHostServer({ host, port, preferredPort })
  const usedFallbackPort = port === undefined && hostServer.port !== preferredPort

  console.log(`@tinytinkerer/host listening at ${hostServer.url}`)
  console.log(`  Web: ${hostServer.url}/`)
  console.log(`  Widget: ${hostServer.url}/widget/`)
  console.log(`  Mobile: ${hostServer.url}/mobile/`)

  if (usedFallbackPort) {
    console.log(`Port ${preferredPort} was unavailable, so the host selected ${hostServer.port}.`)
  }

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
