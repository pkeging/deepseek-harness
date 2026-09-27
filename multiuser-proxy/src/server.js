import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import { WebSocketServer } from './websocket.js'
import { initAuth, handleAuth, getAuthUser } from './auth.js'
import { processManager } from './process-manager.js'
import { serveStatic } from './static.js'

const PORT = parseInt(process.env.DSH_MULTIUSER_PORT || '4000', 10)
const HOST = process.env.DSH_MULTIUSER_HOST || '127.0.0.1'
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function jsonResponse(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function handleAdmin(req, res, user) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = url.pathname

  if (!user || user.role !== 'admin') {
    return jsonResponse(res, 403, { error: '无权限' })
  }

  if (req.method === 'GET' && pathname === '/api/admin/processes') {
    return jsonResponse(res, 200, { processes: processManager.listProcesses() })
  }

  jsonResponse(res, 404, { error: 'Not Found' })
}

async function proxyRequest(req, res, targetPort) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${targetPort}`,
        'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1',
        'x-forwarded-proto': 'http',
        connection: 'close',
      },
    }

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(res)
      proxyRes.on('end', resolve)
      proxyRes.on('error', reject)
    })

    proxyReq.on('error', (err) => {
      console.error('[proxy] request error:', err.message)
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('Bad Gateway: upstream error')
      }
      reject(err)
    })

    proxyReq.setTimeout(30000, () => {
      proxyReq.destroy()
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'text/plain' })
        res.end('Gateway Timeout')
      }
      reject(new Error('timeout'))
    })

    req.pipe(proxyReq)
  })
}

function connectWebSocket(targetPort, path) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(targetPort, '127.0.0.1')
    const key = crypto.randomBytes(16).toString('base64')
    let handshakeDone = false
    let buffer = Buffer.alloc(0)

    socket.once('error', (err) => {
      if (!handshakeDone) reject(err)
    })

    socket.on('data', (chunk) => {
      if (!handshakeDone) {
        buffer = Buffer.concat([buffer, chunk])
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        const response = buffer.slice(0, headerEnd).toString('ascii')
        if (!response.includes('101 Switching Protocols')) {
          socket.destroy()
          reject(new Error('WebSocket handshake failed'))
          return
        }
        const acceptMatch = response.match(/Sec-WebSocket-Accept:\s*(\S+)/i)
        if (!acceptMatch) {
          socket.destroy()
          reject(new Error('Missing Sec-WebSocket-Accept'))
          return
        }
        const expected = crypto.createHash('sha1').update(key + GUID).digest('base64')
        if (acceptMatch[1] !== expected) {
          socket.destroy()
          reject(new Error('Invalid Sec-WebSocket-Accept'))
          return
        }
        handshakeDone = true
        buffer = buffer.slice(headerEnd + 4)
        resolve({ socket, buffer })
      }
    })

    const req = [
      `GET ${path} HTTP/1.1`,
      `Host: 127.0.0.1:${targetPort}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n')
    socket.write(req)
  })
}

function parseWsFrames(buf, onFrame) {
  let offset = 0
  while (offset < buf.length) {
    if (buf.length - offset < 2) break
    const byte1 = buf[offset]
    const byte2 = buf[offset + 1]
    const opcode = byte1 & 0x0f
    const masked = (byte2 & 0x80) !== 0
    let payloadLen = byte2 & 0x7f
    let pos = offset + 2

    if (payloadLen === 126) {
      if (buf.length - pos < 2) break
      payloadLen = buf.readUInt16BE(pos)
      pos += 2
    } else if (payloadLen === 127) {
      if (buf.length - pos < 8) break
      payloadLen = Number(buf.readBigUInt64BE(pos))
      pos += 8
    }

    if (masked) {
      pos += 4
    }

    if (buf.length - pos < payloadLen) break

    const payload = buf.slice(pos, pos + payloadLen)
    onFrame(opcode, payload)
    offset = pos + payloadLen
  }
  return offset
}

function buildWsFrame(opcode, payload) {
  const len = payload.length
  let headerLen = 2
  let payloadLenField = len
  if (len >= 126 && len < 65536) {
    headerLen += 2
    payloadLenField = 126
  } else if (len >= 65536) {
    headerLen += 8
    payloadLenField = 127
  }
  const frame = Buffer.alloc(headerLen + len)
  frame[0] = 0x80 | opcode
  frame[1] = payloadLenField
  if (payloadLenField === 126) frame.writeUInt16BE(len, 2)
  else if (payloadLenField === 127) frame.writeBigUInt64BE(BigInt(len), 2)
  payload.copy(frame, headerLen)
  return frame
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const pathname = url.pathname

    if (pathname.startsWith('/api/')) {
      const user = getAuthUser(req)
      if (pathname.startsWith('/api/auth/')) {
        return handleAuth(req, res)
      }
      if (pathname.startsWith('/api/admin/')) {
        return handleAdmin(req, res, user)
      }
      if (!user) {
        return jsonResponse(res, 401, { error: '未登录' })
      }
      const proc = await processManager.getOrSpawnProcess(user.id)
      if (proc.exited) {
        return jsonResponse(res, 503, { error: '用户会话已结束，请刷新页面重试' })
      }
      return proxyRequest(req, res, proc.port)
    }

    const user = getAuthUser(req)
    if (!user) {
      if (pathname === '/' || pathname === '/login' || pathname === '/register') {
        const file = pathname === '/' ? '/login.html' : `${pathname}.html`
        return serveStatic(req, res, file)
      }
      if (pathname.startsWith('/static/') || pathname.endsWith('.css') || pathname.endsWith('.js')) {
        return serveStatic(req, res, pathname)
      }
      res.writeHead(302, { Location: '/login' })
      return res.end()
    }

    if (pathname === '/login' || pathname === '/register') {
      res.writeHead(302, { Location: '/' })
      return res.end()
    }

    const proc = await processManager.getOrSpawnProcess(user.id)
    if (proc.exited) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end('<h1>服务暂不可用</h1><p>用户会话正在重启，请稍后刷新。</p>')
    }

    return proxyRequest(req, res, proc.port)
  } catch (err) {
    console.error('[server] error:', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Internal Server Error')
    }
  }
}

export function startServer() {
  const server = http.createServer(handleRequest)
  WebSocketServer(server, async (clientWs, req) => {
    try {
      const user = getAuthUser(req)
      if (!user) {
        clientWs.close(1008, 'Unauthorized')
        return
      }
      const proc = await processManager.getOrSpawnProcess(user.id)
      if (proc.exited) {
        clientWs.close(1011, 'Session ended')
        return
      }

      const { socket: targetSocket } = await connectWebSocket(proc.port, req.url)
      let targetBuffer = Buffer.alloc(0)

      targetSocket.on('data', (chunk) => {
        targetBuffer = Buffer.concat([targetBuffer, chunk])
        const consumed = parseWsFrames(targetBuffer, (opcode, payload) => {
          if (opcode === 0x08) {
            clientWs.close(1000)
            targetSocket.end()
          } else if (opcode === 0x01 || opcode === 0x02) {
            clientWs.send(payload)
          }
        })
        targetBuffer = targetBuffer.slice(consumed)
      })

      targetSocket.on('close', () => clientWs.close(1011, 'Upstream closed'))
      targetSocket.on('error', () => clientWs.close(1011, 'Upstream error'))

      clientWs.on('message', (data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
        targetSocket.write(buildWsFrame(0x01, buf))
      })

      clientWs.on('close', () => targetSocket.destroy())
      clientWs.on('error', () => targetSocket.destroy())
    } catch (err) {
      console.error('[ws] error:', err.message)
      try { clientWs.close(1011, 'Internal error') } catch {}
    }
  })

  initAuth()

  server.listen(PORT, HOST, () => {
    console.log(`\n========================================`)
    console.log(`  52kg Harness Multi-User Proxy`)
    console.log(`  Listening on http://${HOST}:${PORT}`)
    console.log(`  Data dir: ${process.env.DSH_MULTIUSER_DATA || './data'}`)
    console.log(`========================================\n`)
  })

  return server
}
