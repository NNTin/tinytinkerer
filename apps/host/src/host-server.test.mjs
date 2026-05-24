// @ts-check

import { createServer as createHttpServer } from 'node:http'
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
    server.listen(0, '127.0.0.1', () => {
      activeClosers.add(() => closeServer(server))
      resolve(server)
    })
  })

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

  it('serves the web app from the root path', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const response = await fetch(`${sharedHostServer.url}/`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('<title>web</title>')
    expect(body).toContain('src="/src/main.tsx"')
  })

  it('redirects non-suffixed widget and mobile paths', async () => {
    if (!sharedHostServer) {
      throw new Error('Expected the shared host server to be available.')
    }

    const widgetResponse = await fetch(`${sharedHostServer.url}/widget`, { redirect: 'manual' })
    const mobileResponse = await fetch(`${sharedHostServer.url}/mobile`, { redirect: 'manual' })

    expect(widgetResponse.status).toBe(301)
    expect(widgetResponse.headers.get('location')).toBe('/widget/')
    expect(mobileResponse.status).toBe(301)
    expect(mobileResponse.headers.get('location')).toBe('/mobile/')
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

  it('falls back to a free port when the preferred port is unavailable', async () => {
    const blocker = await startBlocker()
    const blockerAddress = blocker.address()
    if (!blockerAddress || typeof blockerAddress === 'string') {
      throw new Error('Expected blocker to listen on a TCP address.')
    }

    const hostServer = await createHostServer({
      preferredPort: blockerAddress.port,
      disableDependencyOptimization: true
    })
    activeClosers.add(() => hostServer.close())

    expect(hostServer.port).not.toBe(blockerAddress.port)
    expect(hostServer.port).toBeGreaterThan(0)
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
      `Port ${blockerAddress.port} is already in use on 127.0.0.1. Set PORT to an open port and retry.`
    )
  })
})
