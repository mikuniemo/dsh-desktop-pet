/**
 * 本机桥接服务：只监听 127.0.0.1，用一次性 token 认证。
 *
 * 两个消费方：
 *   - 桌面程序（pet/）：GET /stream 建 SSE 长连接拿演出指令，POST /pet/* 回报状态；
 *   - Harness 设置页（client.js）：POST /api/* 读写设置、遥控桌宠。
 *
 * 为什么不用 ctx.webServer：那个端口是 GUI 的，带登录态与 token 注入；桌宠是
 * 独立进程，还要能在 DSH 重启前后自己重连。自带一个小服务器最简单也最不容易
 * 跟宿主版本耦合。
 */
import http from 'node:http'
import crypto from 'node:crypto'

/** 读取请求体（JSON），超过 1MB 直接拒绝。 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`invalid json: ${String((error && error.message) || error)}`))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  })
  res.end(text)
}

const CORS_PREFLIGHT = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Max-Age': '86400'
}

export function createToken() {
  return crypto.randomBytes(24).toString('hex')
}

/**
 * @param {{
 *   port: number,
 *   token: string,
 *   log: (level: string, message: string, extra?: unknown) => void,
 *   getState: (extra: {pet: object}) => object,
 *   onSettingsPatch: (patch: object) => object,
 *   onPetHello: (info: object) => void,
 *   onPetPrefs: (prefs: object) => void,
 *   onPetEvent: (event: object) => void
 * }} options
 */
export function createBridge(options) {
  const log = options.log || (() => {})
  const token = options.token || createToken()
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set()
  let server = null
  let actualPort = 0
  let heartbeat = null

  const petInfo = {
    connected: false,
    since: null,
    character: '',
    scale: 1,
    version: '',
    pid: 0,
    lastSeen: null,
    position: null
  }

  function authorize(req, url) {
    const header = req.headers['authorization']
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return timingSafeEqual(header.slice(7).trim(), token)
    }
    const given = url.searchParams.get('token')
    return given ? timingSafeEqual(given, token) : false
  }

  function timingSafeEqual(a, b) {
    const left = Buffer.from(String(a))
    const right = Buffer.from(String(b))
    if (left.length !== right.length) return false
    return crypto.timingSafeEqual(left, right)
  }

  function broadcast(payload) {
    const frame = `data: ${JSON.stringify(payload)}\n\n`
    for (const client of [...clients]) {
      try {
        client.write(frame)
      } catch (error) {
        clients.delete(client)
      }
    }
  }

  function petSnapshot() {
    return { ...petInfo, connected: petInfo.connected && clients.size > 0 }
  }

  function openStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    })
    res.write(': dsh-desktop-pet bridge\n\n')
    clients.add(res)
    petInfo.connected = true
    petInfo.since = petInfo.since || Date.now()
    try {
      res.write(
        `data: ${JSON.stringify({
          type: 'hello',
          server: 'dsh-desktop-pet',
          version: options.version || '0.1.0',
          state: options.getState({ pet: petSnapshot() })
        })}\n\n`
      )
    } catch (error) {
      clients.delete(res)
    }
    log('debug', `桌宠连上桥接（当前 ${clients.size} 条连接）`)
    const close = () => {
      clients.delete(res)
      if (clients.size === 0) {
        petInfo.connected = false
        petInfo.since = null
        log('info', '桌宠断开了桥接连接')
      }
    }
    req.on('close', close)
    req.on('error', close)
    res.on('error', close)
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const path = url.pathname
    const method = (req.method || 'GET').toUpperCase()

    if (method === 'OPTIONS') {
      res.writeHead(204, CORS_PREFLIGHT)
      res.end()
      return
    }

    // 探针：不带任何秘密，方便脚本/用户确认服务活着。
    if (path === '/health' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        server: 'dsh-desktop-pet',
        version: options.version || '0.1.0',
        port: actualPort,
        pet: petSnapshot()
      })
      return
    }

    if (!authorize(req, url)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' })
      return
    }

    try {
      // ---- 桌面程序侧 ----
      if (path === '/stream' && method === 'GET') {
        openStream(req, res)
        return
      }

      if (path === '/pet/hello' && method === 'POST') {
        const body = await readJson(req)
        petInfo.connected = clients.size > 0
        petInfo.character = String(body.character || petInfo.character || '')
        petInfo.scale = Number(body.scale) || petInfo.scale
        petInfo.version = String(body.version || '')
        petInfo.pid = Number(body.pid) || petInfo.pid
        petInfo.lastSeen = Date.now()
        options.onPetHello && options.onPetHello(body)
        log('info', `桌宠就绪：v${petInfo.version || '?'} pid=${petInfo.pid || '?'} 角色=${petInfo.character || '?'}`)
        sendJson(res, 200, {
          ok: true,
          state: options.getState({ pet: petSnapshot() })
        })
        return
      }

      if (path === '/pet/prefs' && method === 'POST') {
        const body = await readJson(req)
        if (body && typeof body === 'object') {
          if (typeof body.character === 'string') petInfo.character = body.character
          if (Number.isFinite(Number(body.scale))) petInfo.scale = Number(body.scale)
          if (body.position && Number.isFinite(Number(body.position.x)) && Number.isFinite(Number(body.position.y))) {
            petInfo.position = { x: Number(body.position.x), y: Number(body.position.y) }
          }
          petInfo.lastSeen = Date.now()
          options.onPetPrefs && options.onPetPrefs(body)
        }
        sendJson(res, 200, { ok: true })
        return
      }

      if (path === '/pet/event' && method === 'POST') {
        const body = await readJson(req)
        options.onPetEvent && options.onPetEvent(body || {})
        sendJson(res, 200, { ok: true })
        return
      }

      // ---- 设置页侧 ----
      if (path === '/api/state' && method === 'GET') {
        sendJson(res, 200, { ok: true, state: options.getState({ pet: petSnapshot() }) })
        return
      }

      if (path === '/api/settings' && method === 'POST') {
        const body = await readJson(req)
        const patch = body && typeof body === 'object' && body.patch ? body.patch : body
        const result = options.onSettingsPatch(patch || {})
        sendJson(res, 200, {
          ok: true,
          settings: result.settings,
          changed: result.changed,
          state: options.getState({ pet: petSnapshot() })
        })
        return
      }

      if (path === '/api/pet/command' && method === 'POST') {
        const body = await readJson(req)
        const kind = String((body && body.kind) || '')
        const allowed = [
          'show',
          'hide',
          'reset-position',
          'quit',
          'reload',
          'pat',
          'wave',
          // 试演：让用户/设置页单独看看某个状态的演出
          'error',
          'sleep',
          'eat',
          'think',
          'work',
          'done',
          // 打开/聚焦 DSH 界面窗口（DSH 启动脚本也走这条）
          'open-gui'
        ]
        if (!allowed.includes(kind)) {
          sendJson(res, 400, { ok: false, error: `unknown command: ${kind}` })
          return
        }
        broadcast({ type: 'command', kind })
        sendJson(res, 200, { ok: true, delivered: clients.size > 0, pet: petSnapshot() })
        return
      }

      if (path === '/api/say' && method === 'POST') {
        const body = await readJson(req)
        const text = String((body && body.text) || '').slice(0, 120)
        if (!text) {
          sendJson(res, 400, { ok: false, error: 'empty text' })
          return
        }
        broadcast({ type: 'act', act: { kind: 'say', action: 'click', text, tone: 'happy' } })
        sendJson(res, 200, { ok: true, delivered: clients.size > 0 })
        return
      }

      sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      log('warn', `桥接请求失败 ${method} ${path}：${String((error && error.message) || error)}`)
      if (!res.headersSent) sendJson(res, 400, { ok: false, error: String((error && error.message) || error) })
      else res.end()
    }
  }

  /**
   * 启动服务；端口被占用时向后顺延最多 8 个端口。
   * @returns {Promise<{port: number}>}
   */
  function start() {
    const preferred = Number.isFinite(Number(options.port)) ? Number(options.port) : 0
    return new Promise((resolve, reject) => {
      let attempt = 0
      const maxAttempts = preferred === 0 ? 1 : 9

      const tryListen = () => {
        const port = preferred === 0 ? 0 : preferred + attempt
        const candidate = http.createServer((req, res) => {
          void handle(req, res)
        })
        candidate.on('error', (error) => {
          if (error && error.code === 'EADDRINUSE' && attempt + 1 < maxAttempts) {
            attempt += 1
            tryListen()
            return
          }
          reject(error)
        })
        candidate.listen(port, '127.0.0.1', () => {
          server = candidate
          actualPort = candidate.address() && candidate.address().port ? candidate.address().port : port
          heartbeat = setInterval(() => {
            for (const client of [...clients]) {
              try {
                client.write(': ping\n\n')
              } catch (error) {
                clients.delete(client)
              }
            }
          }, 20000)
          if (heartbeat.unref) heartbeat.unref()
          log('info', `桥接服务已就绪：http://127.0.0.1:${actualPort}`)
          resolve({ port: actualPort })
        })
      }

      tryListen()
    })
  }

  function close() {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    for (const client of [...clients]) {
      try {
        client.end()
      } catch (error) {
        // 关连接失败无所谓
      }
    }
    clients.clear()
    petInfo.connected = false
    if (server) {
      try {
        server.close()
      } catch (error) {
        // 已经关了
      }
      server = null
    }
  }

  return {
    start,
    close,
    broadcast,
    getPort: () => actualPort,
    getToken: () => token,
    pet: petSnapshot
  }
}
