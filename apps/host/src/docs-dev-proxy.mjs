// @ts-check

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { TLSSocket } from 'node:tls'

/** @typedef {import('node:http').ClientRequest} ClientRequest */
/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */
/** @typedef {import('node:stream').Duplex} Duplex */

/**
 * @param {URL} target
 * @returns {typeof httpRequest}
 */
const requestForTarget = (target) => (target.protocol === 'https:' ? httpsRequest : httpRequest)
const badGatewayBody = 'Documentation server is unavailable.'

/**
 * Preserve the browser request while making the upstream Host header match the
 * Docusaurus server. webpack-dev-server validates this header by default.
 *
 * @param {IncomingMessage} req
 * @param {URL} target
 * @returns {IncomingMessage['headers']}
 */
const proxyHeaders = (req, target) => ({
  ...req.headers,
  host: target.host,
  'x-forwarded-host': req.headers.host ?? '',
  'x-forwarded-proto': req.socket instanceof TLSSocket ? 'https' : 'http'
})

/**
 * @param {Duplex} socket
 */
const writeSocketBadGateway = (socket) => {
  if (socket.destroyed) return
  socket.end(
    `HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(badGatewayBody)}\r\n\r\n${badGatewayBody}`
  )
}

/**
 * @param {IncomingMessage} response
 * @returns {string}
 */
const serializeUpgradeResponse = (response) => {
  const status = `HTTP/${response.httpVersion} ${response.statusCode ?? 101} ${response.statusMessage ?? 'Switching Protocols'}`
  const headerLines = []
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    headerLines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`)
  }
  const headers = headerLines.join('\r\n')
  return `${status}\r\n${headers}\r\n\r\n`
}

/**
 * @param {string} origin
 */
export const createDocsDevProxy = (origin) => {
  const upstream = new URL(origin)
  if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
    throw new Error(`Unsupported documentation development origin: ${upstream.protocol}`)
  }

  return {
    /**
     * @param {IncomingMessage} req
     * @param {ServerResponse} res
     */
    handleRequest(req, res) {
      const target = new URL(req.url ?? '/', upstream)
      const proxyRequest = requestForTarget(target)(
        target,
        {
          method: req.method,
          headers: proxyHeaders(req, target)
        },
        (proxyResponse) => {
          res.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers)
          proxyResponse.pipe(res)
        }
      )

      proxyRequest.on('error', () => {
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.statusCode = 502
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(badGatewayBody)
      })
      req.pipe(proxyRequest)
    },

    /**
     * @param {IncomingMessage} req
     * @param {Duplex} socket
     * @param {Buffer} head
     */
    handleUpgrade(req, socket, head) {
      const target = new URL(req.url ?? '/', upstream)
      /** @type {ClientRequest} */
      const proxyRequest = requestForTarget(target)(target, {
        method: 'GET',
        headers: proxyHeaders(req, target)
      })

      proxyRequest.on('upgrade', (proxyResponse, proxySocket, proxyHead) => {
        // Webpack keeps sending HMR frames for the lifetime of the browser
        // connection. Tear down the other half as soon as either socket closes
        // so a tab refresh cannot leave the proxy writing into a dead socket.
        socket.on('error', () => proxySocket.destroy())
        socket.once('close', () => proxySocket.destroy())
        proxySocket.on('error', () => socket.destroy())
        proxySocket.once('close', () => socket.destroy())

        socket.write(serializeUpgradeResponse(proxyResponse))
        if (head.length > 0) proxySocket.write(head)
        if (proxyHead.length > 0) socket.write(proxyHead)
        proxySocket.pipe(socket)
        socket.pipe(proxySocket)
      })
      proxyRequest.on('response', (proxyResponse) => {
        proxyResponse.resume()
        writeSocketBadGateway(socket)
      })
      proxyRequest.on('error', () => writeSocketBadGateway(socket))
      proxyRequest.end()
    }
  }
}
