/** 桌宠自己的本地状态：窗口位置、启动时的设置快照。设置正本在插件的 settings.json。 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { PetSettings } from '../shared/types'

export interface WindowPosition {
  x: number
  y: number
}

/** 和插件共用同一个数据目录：%APPDATA%/dsh-desktop-pet。 */
export function dataDir(): string {
  return path.join(app.getPath('appData'), 'dsh-desktop-pet')
}

export function bellyDir(): string {
  return path.join(dataDir(), 'belly')
}

function windowFile(): string {
  return path.join(dataDir(), 'window.json')
}

function settingsFile(): string {
  return path.join(dataDir(), 'settings.json')
}

/**
 * 启动时直接读一次插件的设置文件。
 * 这样 DSH 还没起来时桌宠也按上次的设置显示（角色/大小/音效/穿透…）；
 * 桥接连上后 Host 会再推一次权威值。读不到就返回空对象用默认值。
 */
export function loadSettingsSnapshot(): Partial<PetSettings> {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as unknown
    if (parsed && typeof parsed === 'object') return parsed as Partial<PetSettings>
  } catch {
    // 文件不存在/还没写出来
  }
  return {}
}

export function ensureDataDirs(): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.mkdirSync(bellyDir(), { recursive: true })
  } catch {
    // 目录建不出来时静默降级：位置不记忆，投喂会失败但宠物照常显示
  }
}

export function loadWindowPosition(): WindowPosition | null {
  try {
    const raw = fs.readFileSync(windowFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<WindowPosition>
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: Math.round(parsed.x), y: Math.round(parsed.y) }
    }
  } catch {
    // 没存过 / 存坏了
  }
  return null
}

export function saveWindowPosition(position: WindowPosition): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.writeFileSync(windowFile(), `${JSON.stringify(position, null, 2)}\n`, 'utf8')
  } catch {
    // 落盘失败不影响使用
  }
}
