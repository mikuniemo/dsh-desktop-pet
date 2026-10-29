/**
 * 开发辅助：打开 DSH 界面 → 进「设置 → 桌宠」→ 截图。
 *
 * 用法：
 *   GUI_URL="http://127.0.0.1:3080/?token=..." node scripts/gui-shot.mjs out.png
 *
 * 前提：scripts/gui-window 已用 --remote-debugging-port=9333 启动。
 */
import fs from 'node:fs'

const port = Number(process.env.GUI_DEBUG_PORT || 9333)
const out = process.argv[2] || 'docs/shots/gui-settings.png'

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const pages = targets.filter((item) => item.type === 'page')
// 同一个进程里还有桌宠自己的窗口（file://），挑 DSH 界面那个
const page = pages.find((item) => /127\.0\.0\.1:\d+/.test(item.url || '')) || pages[0]
if (!page) {
  console.error('找不到页面 target')
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

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 400))
  return result.result ? result.result.value : undefined
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 按可见文字/aria-label 点一个元素（React 里 el.click() 会正常冒泡）。 */
const CLICK_HELPER = `
window.__petHelper = {
  norm: (s) => (s || '').replace(/\\s+/g, '').toLowerCase(),
  find: (texts, scope) => {
    const root = scope || document;
    const wanted = texts.map((t) => window.__petHelper.norm(t));
    const nodes = [...root.querySelectorAll('button, [role="button"], a, [role="tab"], [role="menuitem"], li, span, div')];
    const hits = nodes.filter((el) => {
      const label = window.__petHelper.norm(el.textContent) + '|' + window.__petHelper.norm(el.getAttribute('aria-label')) + '|' + window.__petHelper.norm(el.getAttribute('title'));
      return label.split('|').some((part) => part && wanted.some((w) => part === w || part.startsWith(w)));
    });
    // 取最内层（文字最少）的那个，避免点到外层容器
    hits.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    return hits[0] || null;
  }
};
'ok'
`

socket.addEventListener('open', async () => {
  try {
    await call('Runtime.enable')
    await call('Page.enable')
    await evaluate(CLICK_HELPER)

    // 等界面起来
    for (let i = 0; i < 40; i += 1) {
      const ready = await evaluate(`document.readyState === 'complete' && !!document.querySelector('#root, body > div')`)
      if (ready) break
      await sleep(250)
    }
    await sleep(1200)

    const title = await evaluate('document.title')
    console.log('页面标题:', title)

    // 1. 关掉可能挡住界面的浮层，然后用快捷键 Ctrl+Alt+, 打开设置（账号菜单里也是这个键）
    async function pressKey(key, code, vk, modifiers) {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
      await sleep(250)
    }
    await pressKey('Escape', 'Escape', 27, 0)
    await pressKey('Escape', 'Escape', 27, 0)
    await pressKey(',', 'Comma', 188, 3)
    await sleep(1500)

    const opened = await evaluate(`(() => {
      const text = document.body.innerText || '';
      return text.includes('插件') && (text.includes('通用') || text.includes('模型') || text.includes('外观') || text.includes('账户')) ? 'settings-open' : 'settings-unknown';
    })()`)
    console.log('打开设置:', opened)

    // 2. 点「桌宠」这一页
    const nav = await evaluate(`(() => { const el = window.__petHelper.find(['桌宠','Desktop Pet']); if (!el) return 'no-nav'; el.click(); return 'clicked:' + (el.textContent||'').trim().slice(0,20); })()`)
    console.log('切到桌宠页:', nav)
    await sleep(1500)

    // 3. 页面上出现了什么关键字（用来判断本插件页面真的渲染了）
    const probe = await evaluate(`(() => {
      const text = document.body.innerText || '';
      const keys = ['跟着工具调用演出','说话气泡','头顶显示 token','试演动作','鲸鱼娘','桌宠'];
      const found = keys.filter((k) => text.includes(k));
      return JSON.stringify({ found, sample: text.replace(/\\s+/g,' ').slice(0, 300) });
    })()`)
    console.log('页面探测:', probe)

    const shot = await call('Page.captureScreenshot', { format: 'png' })
    const dir = out.split(/[\\\\/]/).slice(0, -1).join('/')
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
    console.log('截图已保存:', out)
  } catch (error) {
    console.error('失败:', error.message)
    process.exitCode = 1
  } finally {
    socket.close()
  }
})

socket.addEventListener('error', (error) => {
  console.error('ws error', error.message || error)
  process.exit(1)
})
