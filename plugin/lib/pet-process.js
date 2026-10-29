/**
 * 桌面程序（pet/）的定位与托管。
 *
 * 三种启动方式，按优先级：
 *   1. config.petExecutable —— 已打包好的 .exe，最稳；
 *   2. pet/dist/*.exe      —— 仓库里 electron-builder 的便携产物；
 *   3. pet/ + node_modules/electron —— 开发模式，直接拿 electron 跑源码。
 *
 * 插件被安装到 profile 的 node_modules 时，仓库目录可能不在旁边；这种情况下
 * 只能靠 config 指路，找不到就只打日志，不影响插件其余部分。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : ''

function exists(target) {
  try {
    return fs.statSync(target).isFile()
  } catch (error) {
    return false
  }
}

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory()
  } catch (error) {
    return false
  }
}

/** 从插件包目录往上找仓库根（含 pet/package.json 的那一层）。 */
export function findRepoRoot(pluginRoot) {
  let current = path.resolve(pluginRoot)
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = path.join(current, 'pet', 'package.json')
    if (exists(candidate)) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return ''
}

/** 在 pet/dist 里找便携版 exe。 */
function findPackagedExe(appDir) {
  const distDir = path.join(appDir, 'dist')
  if (!isDir(distDir)) return ''
  try {
    const candidates = fs
      .readdirSync(distDir)
      .filter((name) => name.toLowerCase().endsWith('.exe'))
      .filter((name) => !/unins|setup|installer/i.test(name))
      .map((name) => path.join(distDir, name))
      .filter(exists)
    if (candidates.length === 0) return ''
    // 优先体积最大的（便携版通常比安装器单独的 stub 大）
    candidates.sort((a, b) => {
      try {
        return fs.statSync(b).size - fs.statSync(a).size
      } catch (error) {
        return 0
      }
    })
    return candidates[0]
  } catch (error) {
    return ''
  }
}

/** 开发模式下 electron 可执行文件的位置。 */
function findElectronBinary(appDir) {
  const relative =
    process.platform === 'win32'
      ? ['node_modules', 'electron', 'dist', 'electron.exe']
      : process.platform === 'darwin'
        ? ['node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron']
        : ['node_modules', 'electron', 'dist', 'electron']
  const binary = path.join(appDir, ...relative)
  return exists(binary) ? binary : ''
}

/**
 * 解析启动计划。
 * @param {{pluginRoot: string, config: {petExecutable?: string, petAppDir?: string}}} input
 * @returns {{command: string, args: string[], cwd: string, kind: string} | null}
 */
export function resolveLaunch(input) {
  const config = input.config || {}
  const explicitExe = String(config.petExecutable || '').trim()
  if (explicitExe) {
    if (!exists(explicitExe)) return null
    return { command: explicitExe, args: [], cwd: path.dirname(explicitExe), kind: 'executable' }
  }

  const explicitDir = String(config.petAppDir || '').trim()
  const repoRoot = explicitDir ? '' : findRepoRoot(input.pluginRoot)
  const appDir = explicitDir || (repoRoot ? path.join(repoRoot, 'pet') : '')
  if (!appDir || !isDir(appDir)) return null

  const packaged = findPackagedExe(appDir)
  if (packaged) {
    return { command: packaged, args: [], cwd: path.dirname(packaged), kind: 'packaged' }
  }

  const electron = findElectronBinary(appDir)
  if (electron) {
    return { command: electron, args: [appDir], cwd: appDir, kind: 'dev' }
  }

  return null
}

/**
 * 桌宠进程管理器：最多同时一个实例，退出后允许重启（带频率限制）。
 */
export function createPetManager(options) {
  const log = options.log || (() => {})
  let child = null
  let lastExit = 0
  let failures = 0
  let disposed = false

  function running() {
    return Boolean(child && child.exitCode === null && !child.killed)
  }

  function start() {
    if (disposed) return { ok: false, reason: 'disposed' }
    if (running()) return { ok: false, reason: 'already-running' }

    const plan = resolveLaunch({ pluginRoot: options.pluginRoot, config: options.config })
    if (!plan) {
      log(
        'warn',
        '找不到桌宠程序：请在插件配置里设置 petExecutable（打包好的 .exe）或 petAppDir（含 node_modules/electron 的 pet 目录）'
      )
      return { ok: false, reason: 'not-found' }
    }

    const env = {
      ...process.env,
      DSH_DESKTOP_PET_BRIDGE: options.discoveryPath || '',
      DSH_DESKTOP_PET_PORT: String(options.port || ''),
      DSH_DESKTOP_PET_TOKEN: String(options.token || ''),
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    }

    try {
      child = spawn(plan.command, plan.args, {
        cwd: plan.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
        detached: false
      })
    } catch (error) {
      log('warn', `拉起桌宠失败：${String((error && error.message) || error)}`)
      return { ok: false, reason: 'spawn-failed' }
    }

    const tag = `[pet:${plan.kind}]`
    const pipe = (stream, level) => {
      if (!stream) return
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        const text = String(chunk).trim()
        if (!text) return
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) log(level, `${tag} ${line.trim()}`)
        }
      })
    }
    pipe(child.stdout, 'debug')
    pipe(child.stderr, 'debug')

    child.on('exit', (code, signal) => {
      lastExit = Date.now()
      const uptime = lastExit - (child && child.spawnTime ? child.spawnTime : lastExit)
      if (code !== 0) failures += 1
      log('info', `桌宠进程退出：code=${code} signal=${signal || '-'} uptime=${Math.round(uptime / 1000)}s`)
      child = null
    })
    child.spawnTime = Date.now()

    // 启动后 60 秒内反复失败就不再自动重试，避免把用户机器刷爆。
    if (failures >= 3 && Date.now() - lastExit < 60000) {
      log('warn', '桌宠连续启动失败，暂停自动托管；请检查配置或手动启动一次')
      return { ok: false, reason: 'too-many-failures' }
    }

    log('info', `桌宠已拉起（${plan.kind}）：${plan.command}`)
    return { ok: true, kind: plan.kind }
  }

  function stop() {
    disposed = true
    if (!child) return
    const target = child
    child = null
    try {
      target.kill()
    } catch (error) {
      log('warn', `结束桌宠进程失败：${String((error && error.message) || error)}`)
    }
  }

  return { start, stop, running, resolvePlan: () => resolveLaunch({ pluginRoot: options.pluginRoot, config: options.config }) }
}
