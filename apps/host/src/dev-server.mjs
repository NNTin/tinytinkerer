import { createServer as createHttpServer } from 'node:http'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createServer as createViteServer } from 'vite'

const hostPort = Number(process.env.PORT ?? '3000')
const hostName = '127.0.0.1'

const currentDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(currentDir, '../../..')

const apps = [
  { mountPath: '/mobile/', root: join(workspaceRoot, 'apps/mobile') },
  { mountPath: '/widget/', root: join(workspaceRoot, 'apps/widget') },
  { mountPath: '/', root: join(workspaceRoot, 'apps/web') }
]

const httpServer = createHttpServer((req, res) => {
  const requestUrl = req.url ?? '/'
  const pathname = requestUrl.split('?')[0] ?? '/'

  if (pathname === '/mobile' || pathname === '/widget') {
    res.statusCode = 301
    res.setHeader('Location', `${pathname}/`)
    res.end()
    return
  }

  const target = apps.find((app) =>
    app.mountPath === '/' ? true : pathname.startsWith(app.mountPath)
  )
  if (!target) {
    res.statusCode = 404
    res.end('Not found')
    return
  }

  const initialUrl = req.url
  if (target.mountPath !== '/' && req.url) {
    req.url = req.url.slice(target.mountPath.length - 1) || '/'
  }

  target.server.middlewares(req, res, () => {
    req.url = initialUrl
    res.statusCode = 404
    res.end('Not found')
  })
})

for (const app of apps) {
  app.server = await createViteServer({
    root: app.root,
    configFile: join(app.root, 'vite.config.ts'),
    server: {
      middlewareMode: true,
      hmr: { server: httpServer }
    }
  })
}

httpServer.listen(hostPort, hostName, () => {
  console.log(`@tinytinkerer/host listening at http://${hostName}:${hostPort}`)
})

const shutdown = async () => {
  for (const app of apps) {
    await app.server.close()
  }
  httpServer.close(() => process.exit(0))
}

process.once('SIGINT', () => {
  void shutdown()
})
process.once('SIGTERM', () => {
  void shutdown()
})
