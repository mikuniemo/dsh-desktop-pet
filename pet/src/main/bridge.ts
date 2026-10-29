/**
 * 桥接客户端：连 DSH 插件起的本机服务（HTTP + SSE）。
 *
 * 发现方式：环境变量 DSH_DESKTOP_PET_BRIDGE 指定 bridge.json，或
 * 默认 %APPDATA%/dsh-desktop-pet/bridge.json。文件里是 { port, token }。
 * 断线自动重连（1s→10s 退避），因此 DSH 重启、插件重装都不需要手动重启桌宠。
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

export interface BridgeEndpoint {
  base: string
  token: string
  port: number
}

export function discoveryPath(explicit?: string): string {
  const fromEnv = explicit || process.env.DSH_DESKTOP_PET_BRIDGE
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  // 兜底：%APPDATA%/dsh-desktop-pet/bridge.json
  const appData =
    process.env.APPDATA && process.env.APPDATA.trim()
      ? process.env.APPDATA
      : path.join(process.env.USERPROFILE || '.', 'AppData', 'Roaming')
  return path.join(appData, 'dsh-desktop-pet', 'bridge.json')
}

export function readDiscovery(explicit?: string): BridgeEndpoint | null {
  try {
    const file = discoveryPath(explicit)
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as { port?: number; token?: string }
    if (typeof parsed.port === 'number' && parsed.port > 0 && typeof parsed.token === 'string' && parsed.token) {
      return { base: `http://127.0.0.1:${parsed.port}`, token: parsed.token, port: parsed.port }
    }
  } catch {
    // 文件还没写出来（插件未装 / DSH 没启动）
  }
  return null
}

export interface BridgeHandlers {
  onMessage: (message: Record<string, unknown>) => void
  onStatus: (connected: boolean) => void
  onLog?: (message: string) => void
}

export class BridgeClient {
  private handlers: BridgeHandlers
  private endpoint: BridgeEndpoint | null = null
  private request: http.ClientRequest | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private retryDelay = 1000
  private stopped = false
  private buffer = ''

  constructor(handlers: BridgeHandlers) {
    this.handlers = handlers
  }

  get connected(): boolean {
    return this.request !== null
  }

  get port(): number {
    return this.endpoint ? this.endpoint.port : 0
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.request) {
      try {
        this.request.destroy()
      } catch {
        // 已经断了
      }
      this.request = null
    }
  }

  private log(message: string): void {
    this.handlers.onLog?.(message)
  }

  private scheduleRetry(): void {
    if (this.stopped) return
    if (this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, this.retryDelay)
    this.retryDelay = Math.min(10000, Math.round(this.retryDelay * 1.6))
  }

  private connect(): void {
    if (this.stopped) return
    const endpoint = readDiscovery()
    if (!endpoint) {
      this.handlers.onStatus(false)
      this.retryDelay = 1000
      this.scheduleRetry()
      return
    }
    this.endpoint = endpoint

    const url = new URL(`${endpoint.base}/stream?token=${encodeURIComponent(endpoint.token)}`)
    const request = http.get(
      { hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, headers: { Accept: 'text/event-stream' } },
      (response) => {
        if (response.statusCode !== 200) {
          this.log(`桥接返回 ${response.statusCode}，稍后重试`)
          response.resume()
          this.scheduleRetry()
          return
        }
        this.retryDelay = 1000
        this.buffer = ''
        this.handlers.onStatus(true)
        this.log(`已连接桥接 ${endpoint.base}`)

        response.setEncoding('utf8')
        response.on('data', (chunk: string) => this.consume(chunk))
        response.on('end', () => {
          this.request = null
          this.handlers.onStatus(false)
          this.scheduleRetry()
        })
        response.on('error', () => {
          this.request = null
          this.handlers.onStatus(false)
          this.scheduleRetry()
        })
      }
    )

    request.on('error', () => {
      this.request = null
      this.handlers.onStatus(false)
      this.scheduleRetry()
    })
    request.setTimeout(0)
    this.request = request
  }

  /** 增量解析 SSE：以空行分隔事件块，只认 data: 行。 */
  private consume(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n\n')
    while (index >= 0) {
      const block = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 2)
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')
      if (data) {
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>
          this.handlers.onMessage(parsed)
        } catch {
          this.log(`无法解析桥接消息：${data.slice(0, 120)}`)
        }
      }
      index = this.buffer.indexOf('\n\n')
    }
  }

  /** 向 Host 回报状态（hello / prefs / event）。 */
  post(pathname: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.send('POST', pathname, body)
  }

  /** 读 Host 当前状态（/api/state）：用来拿最新带 token 的界面地址。 */
  get(pathname: string): Promise<Record<string, unknown> | null> {
    return this.send('GET', pathname, null)
  }

  private send(
    method: 'GET' | 'POST',
    pathname: string,
    body: Record<string, unknown> | null
  ): Promise<Record<string, unknown> | null> {
    const endpoint = this.endpoint
    if (!endpoint) return Promise.resolve(null)
    const payload = body ? JSON.stringify(body) : ''
    const url = `${endpoint.base}${pathname}?token=${encodeURIComponent(endpoint.token)}`
    return new Promise((resolve) => {
      const target = new URL(url)
      const headers: Record<string, string> = {}
      if (payload) {
        headers['content-type'] = 'application/json'
        headers['content-length'] = String(Buffer.byteLength(payload))
      }
      const outgoing = http.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method,
          headers
        },
        (response) => {
          let text = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            text += chunk
          })
          response.on('end', () => {
            try {
              resolve(text ? (JSON.parse(text) as Record<string, unknown>) : null)
            } catch {
              resolve(null)
            }
          })
        }
      )
      outgoing.on('error', () => resolve(null))
      outgoing.end(payload || undefined)
    })
  }
}
