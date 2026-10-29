/**
 * 桌宠的运行时设置存储。
 *
 * 为什么设置不放插件 Config：角色、大小、鼠标穿透这些是“随时会调”的交互状态，
 * 塞进 cordis.patch.yml 既难用又容易被下次 patch 覆盖；Config 只留启动期的
 * 引导参数（端口、是否托管进程、可执行文件路径）。这里用 <数据目录>/settings.json
 * 做唯一事实源，插件 Host、设置页、桌宠进程三方都读它。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** 内置角色 id，必须和 pet 端的 CharacterView 对应。 */
export const CHARACTERS = ['whale', 'cat', 'ghost', 'slime']

/** 行动模式（照原版大肥鱼）：自由散步 / 跟着鼠标跑 / 原地待着。 */
export const MOTION_MODES = ['wander', 'follow', 'still']

/** 默认设置。新增键时同时补进 normalizeSettings 和 SETTING_KEYS。 */
export const DEFAULT_SETTINGS = Object.freeze({
  followTools: true,
  showBubble: true,
  showTokens: true,
  sounds: true,
  character: 'whale',
  scale: 1,
  clickThrough: false,
  alwaysOnTop: true,
  reduceMotion: false,
  idleChatter: true,
  hunger: true,
  visible: true,
  guiInAppWindow: true,
  motionMode: 'wander',
  notifyTurn: true,
  balanceWarn: true
})

/** 各键的取值规则，供 normalize 和设置页渲染共用。 */
export const SETTING_KINDS = Object.freeze({
  followTools: 'boolean',
  showBubble: 'boolean',
  showTokens: 'boolean',
  sounds: 'boolean',
  character: 'character',
  scale: 'number',
  clickThrough: 'boolean',
  alwaysOnTop: 'boolean',
  reduceMotion: 'boolean',
  idleChatter: 'boolean',
  hunger: 'boolean',
  visible: 'boolean',
  guiInAppWindow: 'boolean',
  motionMode: 'motionMode',
  notifyTurn: 'boolean',
  balanceWarn: 'boolean'
})

export const SETTING_KEYS = Object.keys(SETTING_KINDS)

/** 平台数据目录：Windows 走 %APPDATA%，其他平台走 ~/.config。 */
export function dataDir() {
  const base =
    process.env.APPDATA && process.env.APPDATA.trim()
      ? process.env.APPDATA
      : path.join(os.homedir(), '.config')
  return path.join(base, 'dsh-desktop-pet')
}

export function settingsFile() {
  return path.join(dataDir(), 'settings.json')
}

export function discoveryFile() {
  return path.join(dataDir(), 'bridge.json')
}

export function bellyDir() {
  return path.join(dataDir(), 'belly')
}

function clampScale(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_SETTINGS.scale
  return Math.min(1.8, Math.max(0.6, Math.round(number * 100) / 100))
}

/**
 * 把任意输入收敛成合法设置：未知键丢弃，类型不对回落到当前值。
 * @param {Record<string, unknown>} patch 待应用的补丁
 * @param {Record<string, unknown>} base 当前完整设置
 * @returns {Record<string, unknown>} 新的完整设置（不会修改入参）
 */
export function normalizeSettings(patch, base = DEFAULT_SETTINGS) {
  const next = { ...DEFAULT_SETTINGS, ...base }
  if (patch === null || typeof patch !== 'object') return next
  for (const key of SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    const kind = SETTING_KINDS[key]
    const value = patch[key]
    if (kind === 'boolean') {
      if (typeof value === 'boolean') next[key] = value
    } else if (kind === 'character') {
      if (typeof value === 'string' && CHARACTERS.includes(value)) next[key] = value
    } else if (kind === 'motionMode') {
      if (typeof value === 'string' && MOTION_MODES.includes(value)) next[key] = value
    } else if (kind === 'number') {
      next[key] = clampScale(value)
    }
  }
  return next
}

/**
 * 设置存储：内存副本 + 原子写入 + 订阅广播。
 */
export class SettingsStore {
  /** @param {{file?: string, log?: (level: string, message: string, extra?: unknown) => void}} [options] */
  constructor(options = {}) {
    this.file = options.file || settingsFile()
    this.log = options.log || (() => {})
    this.listeners = new Set()
    this.value = this.#load()
  }

  #load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      return normalizeSettings(parsed, DEFAULT_SETTINGS)
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        this.log('warn', `读取设置失败，改用默认值：${String(error.message || error)}`)
      }
      return { ...DEFAULT_SETTINGS }
    }
  }

  get() {
    return { ...this.value }
  }

  /**
   * 应用补丁并落盘。
   * @param {Record<string, unknown>} patch
   * @returns {{ settings: Record<string, unknown>, changed: string[] }}
   */
  patch(patch) {
    const before = this.value
    const next = normalizeSettings(patch, before)
    const changed = SETTING_KEYS.filter((key) => before[key] !== next[key])
    if (changed.length === 0) return { settings: { ...next }, changed }
    this.value = next
    this.#persist()
    for (const listener of [...this.listeners]) {
      try {
        listener(this.get(), changed)
      } catch (error) {
        this.log('warn', `设置订阅者抛错：${String((error && error.message) || error)}`)
      }
    }
    return { settings: this.get(), changed }
  }

  #persist() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(temporary, `${JSON.stringify(this.value, null, 2)}\n`, 'utf8')
      fs.renameSync(temporary, this.file)
    } catch (error) {
      this.log('warn', `写入设置失败：${String((error && error.message) || error)}`)
    }
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
