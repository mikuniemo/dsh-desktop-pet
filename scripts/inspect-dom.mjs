/**
 * 开发辅助：连上桌宠窗口的 DevTools 协议，跑一段表达式并打印结果。
 *
 * 用法：
 *   1. 用调试端口启动桌宠： electron.exe . --remote-debugging-port=9222
 *   2. node scripts/inspect-dom.mjs "JSON.stringify({w: innerWidth})"
 */
const port = Number(process.env.PET_DEBUG_PORT || 9222)
const expression = process.argv[2] || 'document.documentElement.outerHTML.length'

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const pages = targets.filter((item) => item.type === 'page')
// 同一个 Electron 进程里可能还有 DSH 界面窗口（http://127.0.0.1:...），
// 默认只碰桌宠自己的 file:// 页面；要看界面窗口就设 PET_TARGET=gui。
const wantGui = String(process.env.PET_TARGET || 'pet').toLowerCase() === 'gui'
const page = wantGui
  ? pages.find((item) => /^https?:/.test(item.url || '')) || pages[0]
  : pages.find((item) => /^file:/.test(item.url || '')) || pages[0]
if (!page) {
  console.error('找不到页面 target：', targets.map((t) => t.type))
  process.exit(1)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1

function call(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data)
  if (!payload.id) return
  const entry = pending.get(payload.id)
  if (!entry) return
  pending.delete(payload.id)
  if (payload.error) entry.reject(new Error(JSON.stringify(payload.error)))
  else entry.resolve(payload.result)
})

socket.addEventListener('open', async () => {
  try {
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    console.log(JSON.stringify(result.result && result.result.value !== undefined ? result.result.value : result, null, 2))
  } catch (error) {
    console.error('evaluate failed:', error.message)
    process.exitCode = 1
  } finally {
    socket.close()
  }
})

socket.addEventListener('error', (error) => {
  console.error('ws error', error.message || error)
  process.exit(1)
})
