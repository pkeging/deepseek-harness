import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export class WebSocket extends EventEmitter {
  constructor(socket, opts = {}) {
    super()
    this.socket = socket
    this.readyState = 0
    this._isServer = opts.isServer || false

    if (this._isServer) {
      this._acceptHandshake()
    }
  }

  _acceptHandshake() {
    const key = this.socket._wsKey
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64')
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n')
    this.socket.write(headers)
    this.readyState = 1
    this.emit('open')
    this._startReader()
  }

  _startReader() {
    let buffer = Buffer.alloc(0)
    this.socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 2) {
        const frame = this._parseFrame(buffer)
        if (!frame) break
        buffer = buffer.slice(frame.bytesConsumed)
        if (frame.opcode === 0x08) {
          this.readyState = 3
          this.socket.end()
          this.emit('close')
          return
        }
        if (frame.opcode === 0x01 || frame.opcode === 0x02) {
          this.emit('message', frame.payload)
        }
      }
    })
    this.socket.on('close', () => {
      this.readyState = 3
      this.emit('close')
    })
    this.socket.on('error', (err) => {
      this.readyState = 3
      this.emit('error', err)
    })
  }

  _parseFrame(buf) {
    if (buf.length < 2) return null
    const byte1 = buf[0]
    const byte2 = buf[1]
    const opcode = byte1 & 0x0f
    const masked = (byte2 & 0x80) !== 0
    let payloadLen = byte2 & 0x7f
    let offset = 2

    if (payloadLen === 126) {
      if (buf.length < offset + 2) return null
      payloadLen = buf.readUInt16BE(offset)
      offset += 2
    } else if (payloadLen === 127) {
      if (buf.length < offset + 8) return null
      payloadLen = Number(buf.readBigUInt64BE(offset))
      offset += 8
    }

    let maskKey = null
    if (masked) {
      if (buf.length < offset + 4) return null
      maskKey = buf.slice(offset, offset + 4)
      offset += 4
    }

    if (buf.length < offset + payloadLen) return null

    let payload = buf.slice(offset, offset + payloadLen)
    if (masked && maskKey) {
      payload = Buffer.from(payload)
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4]
      }
    }

    return { opcode, payload, bytesConsumed: offset + payloadLen }
  }

  send(data) {
    if (this.readyState !== 1) return
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)
    const opcode = typeof data === 'string' ? 0x01 : 0x02
    const frame = this._buildFrame(opcode, payload)
    this.socket.write(frame)
  }

  _buildFrame(opcode, payload) {
    const len = payload.length
    let headerLen = 2
    let payloadLenField = len

    if (len < 126) {
    } else if (len < 65536) {
      headerLen += 2
      payloadLenField = 126
    } else {
      headerLen += 8
      payloadLenField = 127
    }

    const frame = Buffer.alloc(headerLen + len)
    frame[0] = 0x80 | opcode
    frame[1] = payloadLenField

    if (payloadLenField === 126) {
      frame.writeUInt16BE(len, 2)
    } else if (payloadLenField === 127) {
      frame.writeBigUInt64BE(BigInt(len), 2)
    }

    payload.copy(frame, headerLen)
    return frame
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason, 'utf8'))
    payload.writeUInt16BE(code, 0)
    Buffer.from(reason, 'utf8').copy(payload, 2)
    const frame = this._buildFrame(0x08, payload)
    this.socket.write(frame)
    this.readyState = 2
    setTimeout(() => {
      if (this.readyState !== 3) {
        this.socket.destroy()
      }
    }, 1000)
  }
}

export function WebSocketServer(server, onConnection) {
  server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key']
    if (!key || req.headers['upgrade']?.toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }
    socket._wsKey = key
    const ws = new WebSocket(socket, { isServer: true })
    ws.once('open', () => onConnection(ws, req))
  })
}
