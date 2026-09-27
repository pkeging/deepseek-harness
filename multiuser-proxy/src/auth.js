import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'

const DATA_DIR = process.env.DSH_MULTIUSER_DATA || path.resolve(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'users.db')
const SECRET_PATH = path.join(DATA_DIR, 'secret.key')
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000

const REGISTER_WINDOW_MS = 60 * 60 * 1000
const REGISTER_MAX_PER_IP = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_PER_USER = 10
const LOGIN_MAX_PER_IP = 30

let db
let JWT_SECRET
const registerAttempts = new Map()
const loginAttempts = new Map()

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function loadOrCreateSecret() {
  ensureDataDir()
  if (process.env.DSH_MULTIUSER_SECRET) {
    JWT_SECRET = Buffer.from(process.env.DSH_MULTIUSER_SECRET, 'utf8')
    return
  }
  if (fs.existsSync(SECRET_PATH)) {
    JWT_SECRET = fs.readFileSync(SECRET_PATH)
  } else {
    JWT_SECRET = crypto.randomBytes(64)
    fs.writeFileSync(SECRET_PATH, JWT_SECRET)
    try { fs.chmodSync(SECRET_PATH, 0o600) } catch {}
  }
}

function initDb() {
  ensureDataDir()
  db = new DatabaseSync(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `)
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512')
  return `${salt.toString('base64')}$${hash.toString('base64')}`
}

function verifyPassword(password, stored) {
  const [saltB64, hashB64] = stored.split('$')
  if (!saltB64 || !hashB64) return false
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')
  const actual = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512')
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}

function base64urlEncode(buf) {
  return buf.toString('base64url')
}

function base64urlDecode(str) {
  return Buffer.from(str, 'base64url')
}

function signJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = { ...payload, iat: now, exp: now + Math.floor(SESSION_TTL / 1000) }
  const data = `${base64urlEncode(Buffer.from(JSON.stringify(header)))}.${base64urlEncode(Buffer.from(JSON.stringify(fullPayload)))}`
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')
  return `${data}.${signature}`
}

function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts
  const data = `${headerB64}.${payloadB64}`
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')
  if (!crypto.timingSafeEqual(Buffer.from(sigB64), Buffer.from(expected))) return null
  try {
    const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (fwd) {
    return String(fwd).split(',')[0].trim()
  }
  return req.socket.remoteAddress || 'unknown'
}

function pruneOldAttempts(map, windowMs) {
  const now = Date.now()
  for (const [key, entries] of map) {
    const filtered = entries.filter(t => t > now - windowMs)
    if (filtered.length === 0) map.delete(key)
    else map.set(key, filtered)
  }
}

function checkRateLimit(map, key, max, windowMs) {
  pruneOldAttempts(map, windowMs)
  const now = Date.now()
  let entries = map.get(key) || []
  if (entries.length >= max) {
    const retryAfter = Math.ceil((entries[0] + windowMs - now) / 1000)
    return { allowed: false, retryAfter }
  }
  entries.push(now)
  map.set(key, entries)
  return { allowed: true, retryAfter: 0 }
}

function validateUsername(u) {
  if (!u || typeof u !== 'string') return { ok: false, msg: '用户名不能为空' }
  const name = u.trim()
  if (name.length < 3) return { ok: false, msg: '用户名至少 3 个字符' }
  if (name.length > 20) return { ok: false, msg: '用户名不能超过 20 个字符' }
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(name)) {
    return { ok: false, msg: '用户名仅支持字母、数字、中文、下划线' }
  }
  return { ok: true, name }
}

function validatePassword(p) {
  if (!p || typeof p !== 'string') return { ok: false, msg: '密码不能为空' }
  if (p.length < 6) return { ok: false, msg: '密码至少 6 位' }
  if (p.length > 64) return { ok: false, msg: '密码不能超过 64 位' }
  return { ok: true }
}

export function getAuthUser(req) {
  const cookie = req.headers.cookie
  if (!cookie) return null
  const match = cookie.match(/(?:^|;\s*)auth_token=([^;]+)/)
  if (!match) return null
  const payload = verifyJwt(match[1])
  if (!payload) return null
  return { id: payload.sub, username: payload.username, role: payload.role }
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

export async function handleAuth(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const method = req.method

  if (method === 'POST' && url.pathname === '/api/auth/register') {
    return handleRegister(req, res)
  }
  if (method === 'POST' && url.pathname === '/api/auth/login') {
    return handleLogin(req, res)
  }
  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    return handleLogout(req, res)
  }
  if (method === 'GET' && url.pathname === '/api/auth/me') {
    return handleMe(req, res)
  }
  if (method === 'GET' && url.pathname === '/api/auth/boot') {
    return handleBoot(req, res)
  }
  if (method === 'GET' && url.pathname === '/api/auth/check-username') {
    return handleCheckUsername(req, res, url)
  }

  jsonResponse(res, 404, { error: 'Not Found' })
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      data += chunk
    })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

async function handleBoot(req, res) {
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get()
  jsonResponse(res, 200, { is_first: row.count === 0 })
}

async function handleCheckUsername(req, res, url) {
  const username = url.searchParams.get('username')
  const v = validateUsername(username)
  if (!v.ok) {
    return jsonResponse(res, 200, { available: false, reason: v.msg })
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(v.name)
  jsonResponse(res, 200, { available: !existing })
}

async function handleRegister(req, res) {
  const ip = getClientIp(req)

  const rl = checkRateLimit(registerAttempts, ip, REGISTER_MAX_PER_IP, REGISTER_WINDOW_MS)
  if (!rl.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': rl.retryAfter,
    })
    return res.end(JSON.stringify({ error: `注册过于频繁，请 ${rl.retryAfter} 秒后再试` }))
  }

  let body
  try { body = await readJsonBody(req) }
  catch (e) { return jsonResponse(res, 400, { error: '请求格式错误' }) }

  const uv = validateUsername(body.username)
  if (!uv.ok) return jsonResponse(res, 400, { error: uv.msg })

  const pv = validatePassword(body.password)
  if (!pv.ok) return jsonResponse(res, 400, { error: pv.msg })

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(uv.name)
  if (existing) {
    return jsonResponse(res, 409, { error: '该用户名已被注册' })
  }

  const isFirst = db.prepare('SELECT COUNT(*) as count FROM users').get().count === 0
  const role = isFirst ? 'admin' : 'user'
  const now = Date.now()

  const stmt = db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
  const info = stmt.run(uv.name, hashPassword(body.password), role, now)

  const userId = info.lastInsertRowid
  const token = signJwt({ sub: userId, username: uv.name, role })

  const expires = new Date(now + SESSION_TTL).toUTCString()
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `auth_token=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`,
  })
  res.end(JSON.stringify({
    user: { id: userId, username: uv.name, role },
    is_first_registered: isFirst,
  }))
}

async function handleLogin(req, res) {
  const ip = getClientIp(req)

  const rlIp = checkRateLimit(loginAttempts, `ip:${ip}`, LOGIN_MAX_PER_IP, LOGIN_WINDOW_MS)
  if (!rlIp.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': rlIp.retryAfter,
    })
    return res.end(JSON.stringify({ error: `登录尝试过于频繁，请 ${rlIp.retryAfter} 秒后再试` }))
  }

  let body
  try { body = await readJsonBody(req) }
  catch (e) { return jsonResponse(res, 400, { error: '请求格式错误' }) }

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!username || !password) {
    return jsonResponse(res, 400, { error: '请输入用户名和密码' })
  }

  const userKey = `user:${username.toLowerCase()}`
  const rlUser = checkRateLimit(loginAttempts, userKey, LOGIN_MAX_PER_USER, LOGIN_WINDOW_MS)
  if (!rlUser.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': rlUser.retryAfter,
    })
    return res.end(JSON.stringify({ error: `该账号登录失败次数过多，请 ${rlUser.retryAfter} 秒后再试` }))
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return jsonResponse(res, 401, { error: '用户名或密码错误' })
  }

  loginAttempts.delete(userKey)

  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), user.id)

  const token = signJwt({ sub: user.id, username: user.username, role: user.role })
  const expires = new Date(Date.now() + SESSION_TTL).toUTCString()
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `auth_token=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`,
  })
  res.end(JSON.stringify({
    user: { id: user.id, username: user.username, role: user.role },
  }))
}

function handleLogout(req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': 'auth_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
  })
  res.end(JSON.stringify({ ok: true }))
}

function handleMe(req, res) {
  const user = getAuthUser(req)
  if (!user) return jsonResponse(res, 401, { error: '未登录' })
  jsonResponse(res, 200, { user })
}

export function initAuth() {
  loadOrCreateSecret()
  initDb()
  const count = db.prepare('SELECT COUNT(*) as count FROM users').get().count
  console.log(`[auth] 用户表就绪，当前 ${count} 个用户`)
}
