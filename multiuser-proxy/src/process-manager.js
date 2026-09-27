import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'

const DSH_ROOT = process.env.DSH_ROOT || path.resolve(process.cwd(), '..')
const DATA_DIR = process.env.DSH_MULTIUSER_DATA || path.resolve(process.cwd(), 'data')
const USERS_HOME_DIR = path.join(DATA_DIR, 'users')
const PORT_RANGE_START = 4100
const PORT_RANGE_END = 4999

const processes = new Map()
const portAllocator = {
  next: PORT_RANGE_START,
  async findFreePort() {
    for (let port = this.next; port <= PORT_RANGE_END; port++) {
      if (await isPortFree(port)) {
        this.next = port + 1
        return port
      }
    }
    throw new Error('No free ports available')
  },
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port, '127.0.0.1')
  })
}

function userHomeDir(userId) {
  return path.join(USERS_HOME_DIR, `user_${userId}`)
}

function ensureUserHome(userId) {
  const dir = userHomeDir(userId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function waitForPort(port, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1')
        socket.once('connect', () => {
          socket.destroy()
          resolve()
        })
        socket.once('error', reject)
      })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  return false
}

async function getOrSpawnProcess(userId) {
  if (processes.has(userId)) {
    const proc = processes.get(userId)
    if (proc.exited) {
      processes.delete(userId)
    } else {
      return proc
    }
  }

  const dshHome = ensureUserHome(userId)
  const port = await portAllocator.findFreePort()

  const settingsDir = path.join(dshHome, 'settings.yaml')
  if (!fs.existsSync(settingsDir)) {
    const settings = `agent-default-model:
  provider: deepseek
  model: deepseek-chat
`
    fs.writeFileSync(settingsDir, settings, 'utf8')
  }

  const env = {
    ...process.env,
    DSH_HOME: dshHome,
    NODE_ENV: 'production',
  }

  const cmd = process.execPath
  const args = [
    '--import',
    'tsx/esm',
    'apps/cli/src/bin.ts',
    '--profile',
    'web',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--no-open',
  ]

  console.log(`[proc] Spawning dsh for user ${userId} on port ${port}`)
  const child = spawn(cmd, args, {
    cwd: DSH_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const proc = {
    userId,
    port,
    dshHome,
    child,
    startedAt: Date.now(),
    exited: false,
    exitCode: null,
  }

  const logPrefix = `[dsh:user${userId}]`
  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    lines.forEach((line) => console.log(`${logPrefix} ${line}`))
  })
  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    lines.forEach((line) => console.error(`${logPrefix} ${line}`))
  })

  child.on('exit', (code) => {
    proc.exited = true
    proc.exitCode = code
    console.log(`[proc] dsh for user ${userId} exited with code ${code}`)
  })

  child.on('error', (err) => {
    proc.exited = true
    console.error(`[proc] dsh for user ${userId} error:`, err.message)
  })

  processes.set(userId, proc)

  const ready = await waitForPort(port, 120000)
  if (!ready) {
    console.error(`[proc] dsh for user ${userId} failed to start within timeout`)
  }

  return proc
}

function stopProcess(userId) {
  const proc = processes.get(userId)
  if (!proc) return
  proc.child.kill('SIGTERM')
  processes.delete(userId)
}

function listProcesses() {
  return Array.from(processes.entries()).map(([userId, proc]) => ({
    userId,
    port: proc.port,
    startedAt: proc.startedAt,
    exited: proc.exited,
    exitCode: proc.exitCode,
    dshHome: proc.dshHome,
  }))
}

function cleanup() {
  console.log('[proc] Cleaning up all dsh processes...')
  for (const [userId, proc] of processes) {
    if (!proc.exited) {
      proc.child.kill('SIGTERM')
    }
  }
  processes.clear()
}

process.on('SIGINT', () => {
  cleanup()
  process.exit(0)
})

process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})

export const processManager = {
  getOrSpawnProcess,
  stopProcess,
  listProcesses,
  userHomeDir,
  cleanup,
}
