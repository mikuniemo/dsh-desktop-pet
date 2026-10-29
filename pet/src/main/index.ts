/**
 * 桌宠主进程。
 *
 * 这一层只做窗口/系统集成：透明置顶窗、拖拽、托盘、投喂、位置记忆。
 * "该演什么" 全部由插件通过桥接推来（见 bridge.ts），
 * 形象与动效在渲染进程里（src/renderer）。
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { BridgeClient } from './bridge'
import { hasGuiWindow, openOrFocusGuiWindow } from './gui-window'
import { createMotionEngine, type MotionAction, type WalkState } from './motion'
import {
  bellyDir,
  ensureDataDirs,
  loadSettingsSnapshot,
  loadWindowPosition,
  saveWindowPosition
} from './store'
import type {
  BalanceInfo,
  CharacterId,
  FoodPayload,
  PetAct,
  PetCommand,
  PetSettings,
  PetSnapshot,
  SessionInfo
} from '../shared/types'
import { DEFAULT_SETTINGS, EMPTY_SESSION } from '../shared/types'

/** 窗口逻辑尺寸（scale = 1 时）；实际窗口按 scale 等比放大。
 *  高度在宠物本体(280+10)之上多留一截，给头顶气泡换行放长文本用。 */
const BASE_WIDTH = 300
const BASE_HEIGHT = 430
const DEFAULT_GUI_URL = 'http://127.0.0.1:3080'

/**
 * 判断"已经打开的 DSH 界面"用的标题片段，按顺序尝试。
 * 浏览器标签标题形如「制作DSH大肥鱼桌宠插件 — DeepSeek Harness - 个人 - Microsoft Edge」，
 * 前面是会话标题（会变），所以只认后面的 DeepSeek 段。
 */
const GUI_TITLE_MARKERS = 'DeepSeek Harness,DeepSeek'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let bridge: BridgeClient | null = null
let motion: ReturnType<typeof createMotionEngine> | null = null
// 启动时先读上次设置的快照：DSH 没起来时桌宠也按上次的设置显示，
// 桥接连上后 Host 会再推一次权威值。
let settings: PetSettings = { ...DEFAULT_SETTINGS, ...loadSettingsSnapshot() }
let session: SessionInfo = { ...EMPTY_SESSION }
/** 账户余额（插件查到的，可能为 null）。 */
let balance: BalanceInfo | null = null
let bridgePort = 0
/** 插件给的 DSH 界面地址（带 token 时最好用），拿不到就用默认端口。 */
let guiUrl = DEFAULT_GUI_URL
let pointerInside = false
let dragTimer: NodeJS.Timeout | null = null
let dragOffset = { x: 0, y: 0 }
let quitting = false
/** 主动改窗口大小时置真，避免和下面的"尺寸守门"打架。 */
let applyingBounds = false
/** 在这个时间点之前别自己乱走（正在演工具动作 / 正在被拖）。 */
let busyUntil = 0

function markBusy(ms: number): void {
  busyUntil = Math.max(busyUntil, Date.now() + ms)
}

function log(message: string): void {
  console.log(`[pet] ${message}`)
}

// 桌宠挂在用户桌面上，主进程未捕获异常不该弹一个"JavaScript error"对话框吓人：
// 记日志、继续跑；真崩了还有插件的看门狗会重新拉起。
process.on('uncaughtException', (error) => {
  log(`未捕获异常：${(error && (error.stack || error.message)) || String(error)}`)
})
process.on('unhandledRejection', (reason) => {
  log(`未处理的 Promise 拒绝：${reason instanceof Error ? reason.message : String(reason)}`)
})

function windowSize(scale: number): { width: number; height: number } {
  const safe = Math.min(1.8, Math.max(0.6, Number.isFinite(scale) ? scale : 1))
  return { width: Math.round(BASE_WIDTH * safe), height: Math.round(BASE_HEIGHT * safe) }
}

/**
 * 尺寸守门：窗口大小只允许由设置里的 scale 决定。
 * 系统菜单（Alt+Space → 大小）、跨屏 DPI 变化、系统吸附都可能改窗口大小，
 * 一旦被改，宠物就会在一大片透明区域里缩在角落，所以这里直接扳回去。
 */
function enforceSize(): void {
  if (!win || applyingBounds) return
  const target = windowSize(settings.scale)
  const [width, height] = win.getSize()
  if (width === target.width && height === target.height) return
  const [x, y] = win.getPosition()
  applyingBounds = true
  try {
    win.setBounds({ x, y, width: target.width, height: target.height })
    log(`窗口尺寸被外部改成 ${width}x${height}，已扳回 ${target.width}x${target.height}`)
  } finally {
    setTimeout(() => {
      applyingBounds = false
    }, 250)
  }
}

function snapshot(): PetSnapshot {
  return {
    settings: { ...settings },
    session: { ...session },
    balance: balance ? { ...balance } : null,
    version: app.getVersion(),
    dataDir: path.dirname(bellyDir()),
    bellyDir: bellyDir(),
    bridge: { connected: bridge ? bridge.connected : false, port: bridgePort },
    pid: process.pid
  }
}

function pushSnapshot(): void {
  if (win && !win.isDestroyed()) win.webContents.send('pet:snapshot', snapshot())
}

function pushAct(act: PetAct): void {
  // 有演出就先别散步，免得"边走边说"看起来像抽风
  markBusy(3600)
  if (win && !win.isDestroyed()) win.webContents.send('pet:act', act)
}

/** 把"正在走路"的状态发给渲染进程（换视图 + 播放走路动画）。 */
function pushWalk(state: WalkState): void {
  if (win && !win.isDestroyed()) win.webContents.send('pet:walk', state)
}

/** 自己找的小动作：蹦 / 摇摆 / 伸懒腰。 */
function pushMotionAction(action: MotionAction): void {
  if (win && !win.isDestroyed()) win.webContents.send('pet:action', action)
}

/** 自言自语（inner = 原版那种灰色斜体心声）。 */
function pushSay(text: string, inner: boolean): void {
  if (win && !win.isDestroyed()) win.webContents.send('pet:say', { text, inner })
}

/** 把窗口夹回某块显示器的可见区域，避免拖出屏幕后找不回来。 */
function clampToDisplay(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const point = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) }
  const display = screen.getDisplayNearestPoint(point)
  const area = display.workArea
  return {
    x: Math.min(Math.max(x, area.x - 40), area.x + area.width - width + 40),
    y: Math.min(Math.max(y, area.y - 10), area.y + area.height - height + 10)
  }
}

function defaultPosition(width: number, height: number): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: area.x + area.width - width - 48,
    y: area.y + area.height - height - 16
  }
}

function createWindow(): void {
  const saved = loadWindowPosition()
  const size = windowSize(settings.scale)
  const start = saved || defaultPosition(size.width, size.height)
  const position = clampToDisplay(start.x, start.y, size.width, size.height)

  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: settings.alwaysOnTop,
    show: false,
    title: 'DSH Desktop Pet',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  if (settings.alwaysOnTop) win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (settings.clickThrough) {
    win.setIgnoreMouseEvents(true, { forward: true })
  }

  win.once('ready-to-show', () => {
    if (!win) return
    if (settings.visible) win.showInactive()
    else win.hide()
    enforceSize()
  })

  win.on('resized', () => enforceSize())
  win.on('resize', () => enforceSize())

  win.on('closed', () => {
    win = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function stopDrag(): void {
  if (dragTimer) {
    clearInterval(dragTimer)
    dragTimer = null
  }
  // 松手后给它一点时间说话/落地，再恢复散步
  markBusy(2500)
}

function startDrag(): void {
  if (!win) return
  // 拖着的时候运动引擎必须停手，否则会和手指抢窗口位置
  markBusy(120000)
  const cursor = screen.getCursorScreenPoint()
  const [x, y] = win.getPosition()
  dragOffset = { x: cursor.x - x, y: cursor.y - y }
  stopDrag()
  dragTimer = setInterval(() => {
    if (!win) return
    const point = screen.getCursorScreenPoint()
    const size = win.getSize()
    const next = clampToDisplay(point.x - dragOffset.x, point.y - dragOffset.y, size[0], size[1])
    win.setPosition(next.x, next.y)
  }, 16)
}

function rememberPosition(): void {
  if (!win) return
  const [x, y] = win.getPosition()
  saveWindowPosition({ x, y })
}

function resizeForScale(previousScale: number): void {
  if (!win) return
  const [x, y] = win.getPosition()
  const [width, height] = win.getSize()
  const next = windowSize(settings.scale)
  // 以底边中点为锚，换大小的时候宠物不会跳。
  const anchorX = x + width / 2
  const bottom = y + height
  const target = clampToDisplay(anchorX - next.width / 2, bottom - next.height, next.width, next.height)
  applyingBounds = true
  try {
    win.setBounds({ x: target.x, y: target.y, width: next.width, height: next.height })
  } finally {
    setTimeout(() => {
      applyingBounds = false
    }, 250)
  }
  log(`缩放 ${previousScale} → ${settings.scale}`)
  rememberPosition()
}

/**
 * 应用设置。
 * @param raw 变更的键
 * @param options.persist 本地操作（托盘/命令）改的设置要回写 Host 落盘，
 *   否则重启后会被 Host 的旧值盖掉；Host 推来的值（默认 false）不再回写，避免回声。
 */
function applySettings(raw: Partial<PetSettings>, options: { persist?: boolean } = {}): void {
  const previous = settings
  settings = { ...previous, ...raw }
  if (win) {
    if (settings.scale !== previous.scale) {
      resizeForScale(previous.scale)
    }
    if (settings.alwaysOnTop !== previous.alwaysOnTop) {
      win.setAlwaysOnTop(settings.alwaysOnTop, 'floating')
    }
    if (settings.clickThrough !== previous.clickThrough) {
      pointerInside = false
      if (settings.clickThrough) win.setIgnoreMouseEvents(true, { forward: true })
      else win.setIgnoreMouseEvents(false)
    }
    if (settings.visible !== previous.visible) {
      if (settings.visible) {
        win.showInactive()
      } else {
        win.hide()
      }
    }
  }
  if (options.persist) {
    const changed: Record<string, unknown> = {}
    for (const key of Object.keys(raw) as Array<keyof PetSettings>) {
      if (settings[key] !== previous[key]) changed[key] = settings[key]
    }
    if (Object.keys(changed).length > 0 && bridge?.connected) {
      // Host 落盘后会再广播回来（值相同，幂等）；桥没连上时下次 hello 会带上我们的快照
      void bridge.post('/pet/prefs', { settings: changed })
    }
  }
  rebuildTrayMenu()
  pushSnapshot()
}

function setCharacter(id: CharacterId): void {
  if (settings.character === id) return
  settings = { ...settings, character: id }
  pushSnapshot()
  rebuildTrayMenu()
  void bridge?.post('/pet/prefs', { character: id })
  log(`切换到角色 ${id}`)
}

function feedFiles(paths: string[]): FoodPayload | null {
  const list = paths.filter((item) => typeof item === 'string' && item.length > 0)
  if (list.length === 0) return null
  const target = bellyDir()
  try {
    fs.mkdirSync(target, { recursive: true })
  } catch {
    return null
  }
  let eaten = 0
  let skipped = 0
  let firstName = ''
  let icon: string | undefined
  for (const source of list) {
    const name = path.basename(source)
    try {
      let destination = path.join(target, name)
      if (fs.existsSync(destination)) {
        const extension = path.extname(name)
        const stem = path.basename(name, extension)
        destination = path.join(target, `${stem}-${Date.now()}${extension}`)
      }
      try {
        fs.renameSync(source, destination)
      } catch {
        fs.copyFileSync(source, destination)
        fs.unlinkSync(source)
      }
      eaten += 1
      if (!firstName) {
        firstName = name
        // 尽量拿到系统图标给气泡里的"食物卡"用
        void app.getFileIcon(destination, { size: 'normal' }).then((image) => {
          if (image && !image.isEmpty()) icon = image.toDataURL()
        })
      }
    } catch (error) {
      skipped += 1
      log(`投喂失败：${name} ${String(error)}`)
    }
  }
  if (eaten === 0) return null
  return { name: firstName, count: eaten, icon, skipped }
}

function openExternal(target: string): void {
  void shell.openExternal(target).catch(() => undefined)
}

let focusing = false

/** 从 guiUrl 里取出 host:port，交给聚焦脚本做地址栏校验。 */
function guiHostPort(): string {
  try {
    const parsed = new URL(guiUrl)
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    return `${parsed.hostname}:${port}`
  } catch {
    return '127.0.0.1:3080'
  }
}

/**
 * 尝试把"已经打开的 DSH 界面"叫到前台（并准确选中那个标签）。
 *
 * 原生程序没办法直接"点到某个浏览器标签"，所以按能力逐级降级：
 *   1. Win32 找标题含 DeepSeek Harness 的浏览器窗口 → 还原 + 前台化
 *   2. UI Automation 枚举标签页：逐个选中 → 读地址栏 URL → 必须命中本机 DSH 端口
 *      不命中就把原来的标签选回去（避免把用户翻到别的页面上）
 * 两步都失败才算"没打开过"，调用方才去开新标签。
 */
function focusExistingGui(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  if (focusing) return Promise.resolve(true)
  focusing = true

  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'focus-gui.ps1')
    : path.join(app.getAppPath(), 'resources', 'focus-gui.ps1')

  if (!fs.existsSync(script)) {
    focusing = false
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const done = (result: boolean) => {
      if (settled) return
      settled = true
      focusing = false
      resolve(result)
    }
    try {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          '-Markers',
          GUI_TITLE_MARKERS,
          '-ExpectHost',
          guiHostPort()
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
      )
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        output += chunk
        if (output.includes('FOCUSED')) done(true)
        else if (output.includes('NOTFOUND')) done(false)
      })
      child.on('error', () => done(false))
      child.on('close', () => done(/FOCUSED/.test(output)))
      setTimeout(() => done(/FOCUSED/.test(output)), 6000)
    } catch {
      done(false)
    }
  })
}

/**
 * 拿一个"能直接登录"的界面地址。
 *
 * 桌宠刚启动时手上只有默认的 http://127.0.0.1:3080（没有 token），直接开窗口会看到
 * 「dsh web authentication required」。所以每次打开前都向 Host 要一次最新状态，
 * 用里面带 token 的 gui.url；拿不到才退回手里的地址（此时用户可能需要自己去复制链接）。
 */
async function resolveGuiUrl(): Promise<string> {
  try {
    const payload = await bridge?.get('/api/state')
    const state = payload && (payload.state as { gui?: { url?: string } } | undefined)
    const fromHost = state && state.gui && typeof state.gui.url === 'string' ? state.gui.url.trim() : ''
    if (fromHost) {
      guiUrl = fromHost
      return guiUrl
    }
  } catch {
    // 桥接还没连上：用手里的地址兜底
  }
  return guiUrl
}

/** 双击 / 托盘菜单的"打开 DSH"。 */
async function openOrFocusGui(): Promise<void> {
  const target = await resolveGuiUrl()

  // 首选：开在桌宠自己的窗口里——窗口是我们创建的，聚焦 100% 可靠，也不会刷标签页。
  if (settings.guiInAppWindow) {
    const result = openOrFocusGuiWindow(target)
    if (result.ok) {
      log(result.created ? '已用独立窗口打开 DSH' : '已聚焦现有的 DSH 窗口')
      pushAct({
        action: 'done',
        text: result.created ? 'DSH 给你打开了～' : 'DSH 已经开着啦，帮你叫到前面～',
        tone: 'happy',
        kind: 'focus'
      })
      return
    }
    log(`独立窗口打开失败（${result.reason || 'unknown'}），退回浏览器`)
  }

  // 次选：找到浏览器里已经打开的 DSH 标签（地址栏校验过的），找不到才新开。
  const focused = await focusExistingGui()
  if (focused) {
    log('已经把已打开的 DSH 界面叫到前台')
    pushAct({ action: 'done', text: 'DSH 已经开着啦，帮你叫到前面～', tone: 'happy', kind: 'focus' })
    return
  }
  log('没找到已打开的 DSH 界面，打开新标签')
  openExternal(target)
}

function rebuildTrayMenu(): void {
  if (!tray) return
  // 托盘是"本地操作"：改完必须回写 Host 落盘，否则重启后被旧设置盖掉
  const persist = { persist: true }
  const menu = Menu.buildFromTemplate([
    {
      label: settings.visible ? '藏起来' : '叫出来',
      click: () => applySettings({ visible: !settings.visible }, persist)
    },
    {
      label: '换个形象',
      submenu: [
        { label: '鲸鱼娘（大肥鱼）', type: 'radio', checked: settings.character === 'whale', click: () => setCharacter('whale') },
        { label: '橘子（橘猫）', type: 'radio', checked: settings.character === 'cat', click: () => setCharacter('cat') },
        { label: '小幽（幽灵）', type: 'radio', checked: settings.character === 'ghost', click: () => setCharacter('ghost') },
        { label: '果冻（史莱姆）', type: 'radio', checked: settings.character === 'slime', click: () => setCharacter('slime') }
      ]
    },
    {
      label: '行动模式',
      submenu: [
        {
          label: '自由散步',
          type: 'radio',
          checked: settings.motionMode === 'wander',
          click: () => applySettings({ motionMode: 'wander' }, persist)
        },
        {
          label: '跟着鼠标跑',
          type: 'radio',
          checked: settings.motionMode === 'follow',
          click: () => applySettings({ motionMode: 'follow' }, persist)
        },
        {
          label: '原地待着',
          type: 'radio',
          checked: settings.motionMode === 'still',
          click: () => applySettings({ motionMode: 'still' }, persist)
        },
        { type: 'separator' },
        { label: '走两步看看', click: () => motion?.nudge() }
      ]
    },
    { type: 'separator' },
    { label: '静音', type: 'checkbox', checked: !settings.sounds, click: () => applySettings({ sounds: !settings.sounds }, persist) },
    {
      label: '鼠标穿透（关掉要去托盘）',
      type: 'checkbox',
      checked: settings.clickThrough,
      click: () => applySettings({ clickThrough: !settings.clickThrough }, persist)
    },
    { label: '始终置顶', type: 'checkbox', checked: settings.alwaysOnTop, click: () => applySettings({ alwaysOnTop: !settings.alwaysOnTop }, persist) },
    { type: 'separator' },
    { label: '回到默认位置', click: () => resetPosition() },
    { label: '打开肚子文件夹', click: () => openExternal(`file:///${bellyDir().replace(/\\/g, '/')}`) },
    { label: '打开 DSH 设置（桌宠页）', click: () => void openOrFocusGui() },
    { type: 'separator' },
    { label: '退出桌宠', click: () => quitApp() }
  ])
  tray.setContextMenu(menu)
  tray.setToolTip('DSH 桌宠 · 双击打开设置')
}

function createTray(): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray.png')
    : path.join(app.getAppPath(), 'resources', 'tray.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    image = nativeImage.createEmpty()
  }
  tray = new Tray(image)
  rebuildTrayMenu()
  tray.on('double-click', () => void openOrFocusGui())
  tray.on('click', () => {
    if (!settings.visible) applySettings({ visible: true })
  })
}

function resetPosition(): void {
  if (!win) return
  const size = win.getSize()
  const next = defaultPosition(size[0], size[1])
  win.setPosition(next.x, next.y)
  saveWindowPosition(next)
}


function handleBridgeMessage(message: Record<string, unknown>): void {
  const type = String(message.type || '')
  if (type === 'hello' || type === 'state') {
    const state = (message.state || message) as {
      settings?: Partial<PetSettings>
      session?: SessionInfo
      pet?: { pid?: number }
      gui?: { url?: string }
    }
    if (state && typeof state.settings === 'object' && state.settings) applySettings(state.settings)
    if (state && state.gui && typeof state.gui.url === 'string' && state.gui.url.trim()) {
      guiUrl = state.gui.url.trim()
    }
    if (state && state.session) {
      session = { ...EMPTY_SESSION, ...state.session }
      pushSnapshot()
    }
    bridgePort = bridge ? bridge.port : bridgePort
    return
  }
  if (type === 'act' && message.act) {
    pushAct(message.act as PetAct)
    return
  }
  if (type === 'session' && message.session) {
    session = { ...EMPTY_SESSION, ...(message.session as SessionInfo) }
    pushSnapshot()
    return
  }
  if (type === 'balance') {
    const incoming = message.balance as BalanceInfo | null
    balance = incoming && typeof incoming.amount === 'number' ? { ...incoming } : null
    pushSnapshot()
    return
  }
  if (type === 'settings' && message.settings) {
    applySettings(message.settings as Partial<PetSettings>)
    return
  }
  if (type === 'command') {
    const kind = String(message.kind || '') as PetCommand
    handleCommand(kind)
  }
}

function handleCommand(command: PetCommand): void {
  switch (command) {
    case 'show':
      applySettings({ visible: true }, { persist: true })
      break
    case 'hide':
      applySettings({ visible: false }, { persist: true })
      break
    case 'reset-position':
      resetPosition()
      break
    case 'reload':
      win?.reload()
      break
    case 'quit':
      quitApp()
      break
    case 'pat':
      pushAct({ action: 'done', text: '嘿嘿～', tone: 'happy', kind: 'pat' })
      break
    case 'wave':
      pushAct({ action: 'done', text: '嗨！', tone: 'happy', kind: 'wave' })
      break
    case 'error':
      pushAct({ action: 'error', text: '出岔子了…', tone: 'angry', kind: 'preview' })
      break
    case 'sleep':
      pushAct({ action: 'sleep', text: '呼…呼…', tone: 'sleepy', kind: 'preview' })
      break
    case 'eat':
      pushAct({ action: 'eat', text: '好吃！', tone: 'happy', kind: 'preview' })
      break
    case 'think':
      pushAct({ action: 'think', text: '让我想想…', tone: 'normal', kind: 'preview' })
      break
    case 'work':
      pushAct({ action: 'read', text: '翻文件看看…', tone: 'normal', kind: 'preview' })
      break
    case 'done':
      pushAct({ action: 'done', text: '搞定！', tone: 'happy', kind: 'preview' })
      break
    case 'open-gui':
      void openOrFocusGui()
      break
    default:
      break
  }
}

function startBridge(): void {
  bridge = new BridgeClient({
    onMessage: handleBridgeMessage,
    onStatus: (connected) => {
      log(connected ? '桥接已连接' : '桥接断开，正在重试')
      bridgePort = bridge ? bridge.port : 0
      if (connected && bridge) {
        void bridge
          .post('/pet/hello', {
            pid: process.pid,
            version: app.getVersion(),
            character: settings.character,
            scale: settings.scale,
            // 带上我们这一侧的完整设置：桥没连上时用户在托盘改的东西，
            // 重连后由 Host 合并落盘，避免被启动时的旧值盖掉
            settings: { ...settings }
          })
          .then((reply) => {
            // hello 的返回里带完整状态（含带 token 的界面地址），顺手用上
            const state = reply && (reply.state as Record<string, unknown> | undefined)
            if (state) handleBridgeMessage({ type: 'state', state })
          })
      }
      pushSnapshot()
    },
    onLog: log
  })
  bridge.start()
  // 心跳：让 Host 知道桌宠还活着（也顺手把位置同步过去，设置页能看到）。
  setInterval(() => {
    if (!bridge || !bridge.connected || !win) return
    const [x, y] = win.getPosition()
    void bridge.post('/pet/prefs', { position: { x, y }, character: settings.character, scale: settings.scale })
  }, 30000)
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', () => snapshot())
  ipcMain.on('pet:ready', () => {
    pushSnapshot()
  })
  ipcMain.on('pet:pointer', (_event, inside: boolean) => {
    if (!win || settings.clickThrough) return
    const next = Boolean(inside)
    if (next === pointerInside) return
    pointerInside = next
    win.setIgnoreMouseEvents(!next, { forward: true })
  })
  ipcMain.on('pet:drag-start', () => startDrag())
  ipcMain.on('pet:drag-end', () => {
    stopDrag()
    rememberPosition()
  })
  ipcMain.on('pet:click', () => {
    pushAct({ action: 'done', text: '嘿嘿～', tone: 'happy', kind: 'click' })
  })
  ipcMain.on('pet:double-click', () => void openOrFocusGui())
  ipcMain.on('pet:set-character', (_event, id: CharacterId) => setCharacter(id))
  ipcMain.on('belly:open', () => openExternal(`file:///${bellyDir().replace(/\\/g, '/')}`))
  ipcMain.on('app:quit', () => quitApp())
  ipcMain.handle('pet:feed', (_event, paths: string[]) => feedFiles(Array.isArray(paths) ? paths : []))
}

function quitApp(): void {
  // DSH 窗口还开着的时候，"退出桌宠"只把宠物收起来，别顺手关掉用户正在用的界面窗口。
  if (hasGuiWindow()) {
    log('DSH 窗口还开着，桌宠先收起，进程保留')
    applySettings({ visible: false })
    pushAct({ action: 'sleep', text: '那我先躲起来～', tone: 'sleepy', kind: 'hide' })
    return
  }
  quitting = true
  stopDrag()
  motion?.stop()
  bridge?.stop()
  app.quit()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (!settings.visible) applySettings({ visible: true })
      win.showInactive()
    }
  })

  // 气泡音效不该被"没有用户手势"拦住。
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

  void app.whenReady().then(() => {
    ensureDataDirs()
    registerIpc()
    createWindow()
    createTray()
    startBridge()

    // 运动引擎：把原版大肥鱼的行为模型搬过来（散步/跟随鼠标/原地待着 + 蹦、摇摆、伸懒腰、自言自语）
    motion = createMotionEngine({
      getWindow: () => win,
      // 缺省按自由散步（老 Host 还没播 motionMode 时也不至于站着不动）
      getMode: () => settings.motionMode || 'wander',
      isBusy: () => Date.now() < busyUntil,
      onWalk: (state) => {
        pushWalk(state)
        if (!state.walking) rememberPosition()
      },
      onAction: (action) => pushMotionAction(action),
      onSay: (text, inner) => pushSay(text, inner),
      log
    })
    motion.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!quitting) {
      // 关掉窗口不等于退出：托盘里还能叫回来。
      if (win === null && !quitting) {
        app.quit()
      }
    }
  })

  app.on('before-quit', () => {
    quitting = true
    stopDrag()
    motion?.stop()
    bridge?.stop()
  })
}
