import fs from 'node:fs'
import path from 'node:path'

const PUBLIC_DIR = path.resolve(import.meta.dirname, '..', 'public')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

function safeJoin(base, target) {
  const resolved = path.resolve(base, '.' + target)
  if (!resolved.startsWith(base)) return null
  return resolved
}

export function serveStatic(req, res, urlPath) {
  const cleanPath = urlPath.split('?')[0]
  let filePath = safeJoin(PUBLIC_DIR, cleanPath)
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    return res.end('Forbidden')
  }

  try {
    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html')
    }
    const content = fs.readFileSync(filePath)
    const mime = getMime(filePath)
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
    })
    res.end(content)
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      return res.end('Not Found')
    }
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    return res.end('Internal Server Error')
  }
}
