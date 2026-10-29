/**
 * dsh-desktop-pet —— Host 半。
 *
 * 职责边界（刻意保持窄）：
 *   - 起本机桥接服务（127.0.0.1 + 一次性 token），让桌面程序和设置页都能接进来；
 *   - 监听会话事件，把工具调用翻译成桌宠动作（只读，不干预 Agent）；
 *   - 把端口/token 写进发现文件，并按需拉起桌面程序；
 *   - 设置存在 <数据目录>/settings.json，宿主/设置页/桌宠三方共用。
 *
 * 这里没有任何 waterfall 注册，装/卸都不改变 Harness 的行为。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBridge, createToken } from './lib/bridge.js'
import { createPetManager } from './lib/pet-process.js'
import { SettingsStore, dataDir, discoveryFile, bellyDir } from './lib/store.js'
import { attachSessionWatcher } from './lib/watcher.js'
import { formatTokens } from './lib/actions.js'

const VERSION = '0.1.0'
const DEFAULT_PORT = 39918
const WATCHDOG_MS = 30000

/**
 * 归一化 patch 里的 config。
 * @param {Record<string, unknown>} input
 */
function normalizeConfig(input) {
  const source = input && typeof input === 'object' ? input : {}
  const level = String(source.logLevel || 'info')
  return {
    enabled: source.enabled !== false,
    port: Number.isFinite(Number(source.port)) ? Math.max(0, Math.floor(Number(source.port))) : DEFAULT_PORT,
    spawnPet: source.spawnPet !== false,
    petAppDir: typeof source.petAppDir === 'string' ? source.petAppDir.trim() : '',
    petExecutable: typeof source.petExecutable === 'string' ? source.petExecutable.trim() : '',
    logLevel: ['silent', 'info', 'debug'].includes(level) ? level : 'info'
  }
}

export function apply(ctx, config) {
  const cfg = normalizeConfig(config)

  /** @type {{level: string, message: string, extra?: unknown}[]} */
  const recent = []
  const LOG_LEVELS = { silent: -1, warn: 0, info: 1, debug: 2 }
  const threshold = LOG_LEVELS[cfg.logLevel] ?? 1

  function log(level, message, extra) {
    const weight = LOG_LEVELS[level] === undefined ? 1 : LOG_LEVELS[level]
    if (weight > threshold) return
    const line = `[desktop-pet] ${message}`
    if (weight >= 1) console.log(line, extra === undefined ? '' : extra)
    else if (weight >= 0) console.warn(line, extra === undefined ? '' : extra)
    recent.push({ at: Date.now(), level, message })
    if (recent.length > 200) recent.shift()
  }

  if (!cfg.enabled) {
    log('info', 'enabled: false，桌宠不启动')
    return
  }

  const token = createToken()
  const store = new SettingsStore({ log })
  const pluginRoot = path.dirname(fileURLToPath(import.meta.url))

  /** 最近一次广播出去的设置快照，用来避免回声循环。 */
  let lastBroadcast = ''
  let petStatus = { connected: false, character: '', scale: 1, version: '', pid: 0, lastSeen: null, position: null }

  /**
   * 账户余额 / 每轮花费。
   *
   * 余额走 Host 的 `deepseekAccount` 可选服务（和 DSH 自己的账号卡片同一条路），
   * 拿不到就整个功能静默关闭，绝不让插件因为查余额而挂掉。
   * 花费 = 两次余额查询之间的差额（只在同一个货币、差值合理时采信）。
   */
  const BALANCE_LOW_THRESHOLD = 5
  const BALANCE_REFRESH_MS = 180000
  const BALANCE_WARN_COOLDOWN_MS = 30 * 60 * 1000
  let balanceState = null
  let lastBalanceAmount = null
  let lastBalanceWarnAt = 0
  let balanceRefreshing = false

  function accountService() {
    try {
      return typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : undefined
    } catch (error) {
      return undefined
    }
  }

  async function refreshBalance(reason) {
    if (balanceRefreshing) return balanceState
    const service = accountService()
    if (!service || typeof service.getBalance !== 'function') return balanceState
    balanceRefreshing = true
    try {
      const result = await service.getBalance({
        version: VERSION,
        locale: String(process.env.DSH_LOCALE || 'zh_CN'),
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
      })
      if (!result || result.status !== 'ready') return balanceState
      const normal = Array.isArray(result.value) ? result.value : []
      const bonus = Array.isArray(result.bonusWallets) ? result.bonusWallets : []
      const sum = (list) =>
        list.reduce((total, wallet) => {
          const value = Number(wallet && wallet.balance)
          return Number.isFinite(value) ? total + value : total
        }, 0)
      const amount = Number((sum(normal) + sum(bonus)).toFixed(6))
      const currency = (normal[0] && normal[0].currency) || (bonus[0] && bonus[0].currency) || 'CNY'
      let lastCost = balanceState && balanceState.lastCost != null ? balanceState.lastCost : null
      if (lastBalanceAmount != null && amount < lastBalanceAmount) {
        const delta = Number((lastBalanceAmount - amount).toFixed(6))
        if (delta > 0 && delta < 100) lastCost = delta
      }
      lastBalanceAmount = amount
      balanceState = {
        amount,
        currency,
        low: amount < BALANCE_LOW_THRESHOLD,
        lastCost,
        updatedAt: Date.now()
      }
      bridge.broadcast({ type: 'balance', balance: balanceState })
      log('debug', `余额 ${amount} ${currency}（${reason}），上一轮花费 ${lastCost}`)

      // 余额不足：饿饿…喂喂…（半小时最多提醒一次）
      if (
        balanceState.low &&
        store.get().balanceWarn &&
        Date.now() - lastBalanceWarnAt > BALANCE_WARN_COOLDOWN_MS
      ) {
        lastBalanceWarnAt = Date.now()
        bridge.broadcast({
          type: 'act',
          act: {
            kind: 'balance-low',
            action: 'think',
            prop: '🍚',
            text: `饿饿…喂喂…（余额剩 ${amount.toFixed(2)}）`,
            tone: 'remind'
          }
        })
      }
      return balanceState
    } catch (error) {
      log('debug', `余额查询失败：${String((error && error.message) || error)}`)
      return balanceState
    } finally {
      balanceRefreshing = false
    }
  }

  /** 一轮结束的播报：token + 花费。 */
  async function reportTurn(act) {
    if (!store.get().notifyTurn) {
      bridge.broadcast({ type: 'act', act })
      return
    }
    await refreshBalance('turn-end')
    const snapshot = watcher.snapshot()
    const tokens = snapshot && snapshot.usage ? snapshot.usage.totalLabel : ''
    const cost = balanceState && balanceState.lastCost ? balanceState.lastCost : null
    const costText = cost ? ` · -¥${cost.toFixed(cost < 0.01 ? 4 : 3)}` : ''
    bridge.broadcast({
      type: 'act',
      act: {
        ...act,
        prop: '💰',
        text: `${act.text || ''}${tokens ? ` ${tokens}` : ''}${costText}`.trim()
      }
    })
  }

  const watcher = attachSessionWatcher(ctx, {
    log,
    onAct(act) {
      if (!store.get().followTools) return
      if (act.kind === 'turn-end') {
        void reportTurn(act)
        return
      }
      bridge.broadcast({ type: 'act', act })
    },
    onState(sessionState) {
      petStatus = { ...petStatus }
      bridge.broadcast({ type: 'session', session: sessionState })
    }
  })

  /**
   * 给桌宠用的 DSH 界面地址：优先带 token 的认证地址，桌宠双击时直接打开它。
   * 两个服务都是可选的（老宿主可能没有），拿不到就返回空串让桌宠用默认端口。
   */
  function resolveGuiUrl() {
    try {
      const webApp = typeof ctx.get === 'function' ? ctx.get('webApp') : undefined
      if (!webApp || typeof webApp.getAdvertisedUrl !== 'function') return ''
      const base = webApp.getAdvertisedUrl()
      if (!base) return ''
      const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
      if (connection && typeof connection.authenticatedUrl === 'function') {
        try {
          return connection.authenticatedUrl(base)
        } catch (error) {
          return base
        }
      }
      return base
    } catch (error) {
      return ''
    }
  }

  function currentState(extra) {
    const settings = store.get()
    const session = watcher.snapshot()
    return {
      version: VERSION,
      settings,
      session: {
        ...session,
        usageLabel: formatTokens(session.usage && session.usage.total)
      },
      pet: (extra && extra.pet) || petStatus,
      gui: { url: resolveGuiUrl() },
      balance: balanceState,
      bridge: { port: bridge.getPort() || cfg.port, startedAt: startedAt },
      dataDir: dataDir(),
      bellyDir: bellyDir()
    }
  }

  const bridge = createBridge({
    port: cfg.port,
    token,
    version: VERSION,
    log,
    getState: currentState,
    onSettingsPatch(patch) {
      const result = store.patch(patch || {})
      return result
    },
    onPetHello(info) {
      petStatus = {
        ...petStatus,
        connected: true,
        character: typeof info.character === 'string' ? info.character : petStatus.character,
        scale: Number(info.scale) || petStatus.scale,
        version: String(info.version || petStatus.version),
        pid: Number(info.pid) || petStatus.pid,
        lastSeen: Date.now()
      }
      // 桌宠在桥断开期间改过设置（托盘换角色/静音/穿透…）：hello 带上了它的完整
      // 设置快照，这里合并落盘，避免 Host 启动时的旧值反过来盖掉用户的改动。
      const patch = {}
      if (info.settings && typeof info.settings === 'object') Object.assign(patch, info.settings)
      if (typeof info.character === 'string' && info.character) patch.character = info.character
      if (Number.isFinite(Number(info.scale))) patch.scale = Number(info.scale)
      if (Object.keys(patch).length > 0) store.patch(patch)
    },
    onPetPrefs(prefs) {
      if (!prefs || typeof prefs !== 'object') return
      petStatus = { ...petStatus, lastSeen: Date.now() }
      if (prefs.position) petStatus.position = prefs.position
      const patch = {}
      // 桌宠托盘/本地操作改的设置（persist 路径）整体合并
      if (prefs.settings && typeof prefs.settings === 'object') Object.assign(patch, prefs.settings)
      if (typeof prefs.character === 'string' && prefs.character && prefs.character !== store.get().character) {
        patch.character = prefs.character
      }
      if (Number.isFinite(Number(prefs.scale)) && Number(prefs.scale) !== store.get().scale) {
        patch.scale = Number(prefs.scale)
      }
      if (Object.keys(patch).length > 0) store.patch(patch)
    },
    onPetEvent(event) {
      petStatus = { ...petStatus, lastSeen: Date.now() }
      const kind = String((event && event.kind) || '')
      if (kind === 'pat' || kind === 'feed' || kind === 'say') {
        log('debug', `桌宠交互：${kind}${event && event.text ? ` ${String(event.text).slice(0, 60)}` : ''}`)
      }
    }
  })

  // 设置一变就推给桌宠；内容没变就不推，避免和 /pet/prefs 形成回声。
  const unsubscribeStore = store.subscribe((settings, changed) => {
    const serialized = JSON.stringify(settings)
    if (serialized === lastBroadcast) return
    lastBroadcast = serialized
    log('debug', `设置变更：${changed.join(', ')}`)
    bridge.broadcast({ type: 'settings', settings })
  })

  const petManager = createPetManager({
    log,
    pluginRoot,
    config: cfg,
    discoveryPath: discoveryFile(),
    port: cfg.port,
    token
  })

  let startedAt = Date.now()
  let watchdog = null
  let balanceTimer = null

  ctx.effect(() => {
    // 数据目录先建好：发现文件、设置、肚子都落在这里。
    try {
      fs.mkdirSync(dataDir(), { recursive: true })
      fs.mkdirSync(bellyDir(), { recursive: true })
    } catch (error) {
      log('warn', `创建数据目录失败：${String((error && error.message) || error)}`)
    }

    bridge
      .start()
      .then(({ port }) => {
        startedAt = Date.now()
        claimPort(port)
        log('info', `桌宠桥接就绪，端口 ${port}；设置文件 ${path.join(dataDir(), 'settings.json')}`)
        maybeStartPet('boot')
      })
      .catch((error) => {
        log('warn', `桥接服务启动失败：${String((error && error.message) || error)}`)
      })

    function claimPort(port) {
      try {
        fs.mkdirSync(dataDir(), { recursive: true })
        const payload = {
          app: 'dsh-desktop-pet',
          version: VERSION,
          port,
          token,
          pid: process.pid,
          startedAt: Date.now()
        }
        fs.writeFileSync(discoveryFile(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      } catch (error) {
        log('warn', `写发现文件失败：${String((error && error.message) || error)}`)
      }
    }

    function maybeStartPet(reason) {
      if (!cfg.spawnPet) return
      if (bridge.pet().connected) {
        log('debug', `桌宠已在连接中，跳过拉起（${reason}）`)
        return
      }
      if (petManager.running()) return
      if (!store.get().visible) {
        log('debug', '设置里桌宠是隐藏状态，暂不拉起')
        return
      }
      const result = petManager.start()
      if (!result.ok && result.reason !== 'already-running') {
        log('debug', `未拉起桌宠（${reason}）：${result.reason}`)
      }
    }

    // 桌宠崩了/被关了：隔 30 秒看一眼，需要就重新拉起。
    watchdog = setInterval(() => {
      if (!cfg.spawnPet) return
      if (bridge.pet().connected) return
      if (petManager.running()) return
      if (!store.get().visible) return
      maybeStartPet('watchdog')
    }, WATCHDOG_MS)
    if (watchdog.unref) watchdog.unref()

    // 余额：启动几秒后查一次，之后每 3 分钟一次（查不到就什么都不做）
    const bootTimer = setTimeout(() => {
      void refreshBalance('boot')
    }, 4000)
    if (bootTimer.unref) bootTimer.unref()
    balanceTimer = setInterval(() => {
      void refreshBalance('timer')
    }, BALANCE_REFRESH_MS)
    if (balanceTimer.unref) balanceTimer.unref()

    return () => {
      if (watchdog) clearInterval(watchdog)
      watchdog = null
      if (balanceTimer) clearInterval(balanceTimer)
      balanceTimer = null
      try {
        unsubscribeStore()
      } catch (error) {
        // 已经退订
      }
      watcher.dispose()
      bridge.close()
      petManager.stop()
      try {
        const file = discoveryFile()
        if (fs.existsSync(file)) fs.unlinkSync(file)
      } catch (error) {
        // 删不掉也不影响下次覆盖
      }
      log('info', '桌宠插件已卸载，桥接与进程都收尾完毕')
    }
  }, 'desktop-pet: bridge, watcher and pet process')

  // 设置页要拿到端口和 token：每次 index 渲染时注入一小段脚本。
  // 没有 webServer 的组成下这个事件不会触发，设置页会退化成读取上次缓存的地址。
  try {
    ctx.on('webserver/index-inject', (table) => {
      if (!Array.isArray(table)) return
      const port = bridge.getPort()
      if (!port) return
      const payload = {
        port,
        token,
        base: `http://127.0.0.1:${port}`,
        version: VERSION
      }
      table.push({
        kind: 'script',
        placement: 'body',
        text: `window.__DSH_DESKTOP_PET__=${JSON.stringify(payload).replace(/</g, '\\u003c')};`
      })
    })
  } catch (error) {
    log('warn', `无法注入设置页地址：${String((error && error.message) || error)}`)
  }

  log('info', `已启用（端口 ${cfg.port}，托管进程 ${cfg.spawnPet ? '开' : '关'}）`)
}
