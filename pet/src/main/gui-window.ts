/**
 * DSH 界面的独立窗口。
 *
 * 为什么由桌宠来开：浏览器标签没法被外部程序"精确选中"，自己开的窗口就可以——
 * 再次双击只要 focus()，不会越开越多；窗口位置/大小也记在本机。
 */
import { app, BrowserWindow, screen, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { dataDir } from './store'

/** 窗口图标：开发时取仓库 resources，打包后取 extraResources。 */
function appIconPath(): string | undefined {
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, 'app-icon.ico') : '',
    path.join(app.getAppPath(), 'resources', 'app-icon.ico')
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      // 忽略
    }
  }
  return undefined
}

interface GuiBounds {
  x?: number
  y?: number
  width?: number
  height?: number
  maximized?: boolean
}

const DEFAULT_WIDTH = 1360
const DEFAULT_HEIGHT = 880

let guiWindow: BrowserWindow | null = null
let loadedUrl = ''

function boundsFile(): string {
  return path.join(dataDir(), 'gui-window.json')
}

function loadBounds(): GuiBounds {
  try {
    const parsed = JSON.parse(fs.readFileSync(boundsFile(), 'utf8')) as GuiBounds
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveBounds(): void {
  if (!guiWindow || guiWindow.isDestroyed()) return
  try {
    const bounds = guiWindow.isMaximized() ? guiWindow.getNormalBounds() : guiWindow.getBounds()
    const payload: GuiBounds = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: guiWindow.isMaximized()
    }
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.writeFileSync(boundsFile(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch {
    // 记不住位置不影响使用
  }
}

export function hasGuiWindow(): boolean {
  return Boolean(guiWindow && !guiWindow.isDestroyed())
}

/**
 * 打开或聚焦 DSH 窗口。
 * @param url 必须是带 token 的完整地址（Host 会通过桥接给过来）
 * @returns `created` 表示这次是新开的窗口
 */
export function openOrFocusGuiWindow(url: string): { ok: boolean; created: boolean; reason?: string } {
  const target = String(url || '').trim()
  if (!target) return { ok: false, created: false, reason: 'no-url' }

  if (hasGuiWindow() && guiWindow) {
    // token 变了（DSH 重启过）→ 用新地址重载，否则只是把它叫到前面
    if (target !== loadedUrl) {
      loadedUrl = target
      void guiWindow.loadURL(target)
    }
    if (guiWindow.isMinimized()) guiWindow.restore()
    guiWindow.show()
    guiWindow.focus()
    return { ok: true, created: false }
  }

  const saved = loadBounds()
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const width = Math.max(720, Math.min(saved.width || DEFAULT_WIDTH, workArea.width))
  const height = Math.max(560, Math.min(saved.height || DEFAULT_HEIGHT, workArea.height))

  guiWindow = new BrowserWindow({
    width,
    height,
    x: saved.x,
    y: saved.y,
    minWidth: 720,
    minHeight: 560,
    title: 'DeepSeek Harness',
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#ffffff',
    icon: appIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  loadedUrl = target

  guiWindow.once('ready-to-show', () => {
    if (!guiWindow) return
    if (saved.maximized) guiWindow.maximize()
    guiWindow.show()
    guiWindow.focus()
  })

  // 页面里的 target=_blank / window.open 一律交给系统浏览器，别在窗口里叠一层
  guiWindow.webContents.setWindowOpenHandler(({ url: opened }) => {
    if (/^https?:/i.test(opened)) void shell.openExternal(opened).catch(() => undefined)
    return { action: 'deny' }
  })

  guiWindow.on('close', () => saveBounds())
  guiWindow.on('closed', () => {
    guiWindow = null
    loadedUrl = ''
  })

  void guiWindow.loadURL(target)
  return { ok: true, created: true }
}

export function focusGuiWindow(): boolean {
  if (!hasGuiWindow() || !guiWindow) return false
  if (guiWindow.isMinimized()) guiWindow.restore()
  guiWindow.show()
  guiWindow.focus()
  return true
}

export function closeGuiWindow(): void {
  if (hasGuiWindow() && guiWindow) guiWindow.close()
}
