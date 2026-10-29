/**
 * 把 DSH 的会话事件翻译成桌宠演出。
 *
 * 只监听，不干预：所有监听都挂在插件的根 context 上，插件卸载时自动摘除，
 * 不注册任何 waterfall（不会改变 Agent 的行为）。
 *
 * 监听面：
 *   session/event  —— turn/start、turn/end、tool/call、tool/result、
 *                     assistant/message(usage)、approval/*、session/title
 *   agent/status   —— idle ⇄ running
 *   agent/error    —— 单步失败
 *
 * 事件契约来自 `cordis_inspect_query` 的 Event 目录（DSH 0.2.1-rc.2）。
 */
import { actForTool, actForTurnEnd, toneForAction, formatTokens } from './actions.js'

/** 同一动作在该窗口内不重复推送（避免刷屏气泡）。 */
const DEDUPE_MS = 350

/** 每个会话保留的工具调用上限，防止长会话把内存吃掉。 */
const MAX_PENDING_CALLS = 200

/**
 * @param {import('cordis').Context} ctx 插件根 context
 * @param {{
 *   onAct: (act: object) => void,
 *   onState: (state: object) => void,
 *   log?: (level: string, message: string, extra?: unknown) => void
 * }} hooks
 * @returns {{ snapshot: () => object, dispose: () => void }}
 */
export function attachSessionWatcher(ctx, hooks) {
  const log = hooks.log || (() => {})
  /** @type {Map<string, {title: string, turn: number, running: boolean, usage: {input: number, output: number}, turnUsage: {input: number, output: number}, pending: Map<string, {name: string, at: number}>}>} */
  const sessions = new Map()
  let activeSessionId = null
  let lastActKey = ''
  let lastActAt = 0

  function ensure(sessionId) {
    const id = String(sessionId || 'default')
    let entry = sessions.get(id)
    if (!entry) {
      entry = {
        title: '',
        turn: 0,
        running: false,
        usage: { input: 0, output: 0 },
        turnUsage: { input: 0, output: 0 },
        pending: new Map()
      }
      sessions.set(id, entry)
    }
    return entry
  }

  function snapshot() {
    const entry = activeSessionId ? sessions.get(activeSessionId) : null
    if (!entry) {
      return {
        sessionId: null,
        title: '',
        turn: 0,
        running: false,
        sessions: sessions.size,
        usage: { input: 0, output: 0, total: 0, totalLabel: '', turn: 0 }
      }
    }
    const total = entry.usage.input + entry.usage.output
    return {
      sessionId: activeSessionId,
      title: entry.title,
      turn: entry.turn,
      running: entry.running,
      sessions: sessions.size,
      usage: {
        input: entry.usage.input,
        output: entry.usage.output,
        total,
        totalLabel: formatTokens(total),
        turn: entry.turnUsage.input + entry.turnUsage.output
      }
    }
  }

  function publishState() {
    try {
      hooks.onState(snapshot())
    } catch (error) {
      log('warn', `推送会话状态失败：${String((error && error.message) || error)}`)
    }
  }

  function emit(act) {
    const key = `${act.action}|${act.text || ''}`
    const now = Date.now()
    if (key === lastActKey && now - lastActAt < DEDUPE_MS) return
    lastActKey = key
    lastActAt = now
    try {
      hooks.onAct({ ...act, tone: act.tone || toneForAction(act.action), at: now })
    } catch (error) {
      log('warn', `推送桌宠动作失败：${String((error && error.message) || error)}`)
    }
  }

  function handleSessionEvent(session, event) {
    const sessionId = session && session.id ? String(session.id) : 'default'
    const type = String((event && event.type) || '')
    const data = (event && event.data) || {}
    const entry = ensure(sessionId)

    // 只有真正产生内容的事件才把会话切到前台，避免后台心跳抢走气泡。
    if (!activeSessionId) activeSessionId = sessionId

    switch (type) {
      case 'session/title': {
        const title = String(data.title == null ? '' : data.title).trim()
        if (title) entry.title = title.slice(0, 120)
        return
      }
      case 'turn/start': {
        activeSessionId = sessionId
        entry.turn = Number(data.turn) || entry.turn + 1
        entry.running = true
        entry.turnUsage = { input: 0, output: 0 }
        entry.pending.clear()
        emit({ kind: 'turn-start', action: 'think', text: '让我想想…' })
        publishState()
        return
      }
      case 'tool/call': {
        activeSessionId = sessionId
        const name = String(data.name || '')
        const callId = String(data.callId || '')
        if (entry.pending.size >= MAX_PENDING_CALLS) {
          const oldest = entry.pending.keys().next()
          if (!oldest.done) entry.pending.delete(oldest.value)
        }
        entry.pending.set(callId, { name, at: Date.now() })
        entry.running = true
        const act = actForTool(name)
        emit({ kind: 'tool-start', action: act.action, text: act.text, tool: name })
        return
      }
      case 'tool/result': {
        const callId = String((data.message && data.message.toolCallId) || '')
        const pending = entry.pending.get(callId)
        if (pending) entry.pending.delete(callId)
        const failed = Boolean(data.error)
        const ms = pending ? Date.now() - pending.at : 0
        emit({
          kind: 'tool-end',
          action: failed ? 'error' : 'read',
          text: failed ? '这步没成…' : '',
          tool: (pending && pending.name) || '',
          ok: !failed,
          ms
        })
        return
      }
      case 'assistant/message': {
        activeSessionId = sessionId
        const usage = data.usage
        if (usage && typeof usage === 'object') {
          const input = Number(usage.inputTokens) || 0
          const output = Number(usage.outputTokens) || 0
          entry.usage.input += input
          entry.usage.output += output
          entry.turnUsage.input += input
          entry.turnUsage.output += output
        }
        emit({ kind: 'step', action: 'think', text: '' })
        publishState()
        return
      }
      case 'turn/end': {
        const act = actForTurnEnd(data.reason)
        entry.running = false
        entry.pending.clear()
        entry.turn = Number(data.turn) || entry.turn
        emit({ kind: 'turn-end', action: act.action, text: act.text, usage: snapshot().usage })
        publishState()
        return
      }
      default: {
        if (type === 'approval/asked') {
          activeSessionId = sessionId
          emit({ kind: 'approval', action: 'ask', text: '等你点允许…' })
          return
        }
        if (type.indexOf('approval/') === 0) {
          emit({ kind: 'approval-done', action: 'think', text: '继续…' })
          return
        }
        // 别的会话产生新事件时，切换前台会话（气泡/标题跟着走），但只在
        // 该会话没被别的动作占着时切换，避免抢演出。
        if (entry.running && activeSessionId !== sessionId) return
        return
      }
    }
  }

  const disposers = []

  try {
    disposers.push(
      ctx.on('session/event', (session, event) => {
        try {
          handleSessionEvent(session, event)
        } catch (error) {
          log('warn', `处理 session/event 失败：${String((error && error.message) || error)}`)
        }
      })
    )
  } catch (error) {
    log('warn', `无法监听 session/event：${String((error && error.message) || error)}`)
  }

  try {
    disposers.push(
      ctx.on('agent/status', (payload) => {
        try {
          const agent = payload && payload.agent
          const id = agent && agent.id ? String(agent.id) : 'default'
          const entry = ensure(id)
          const running = String(payload && payload.status) === 'running'
          entry.running = running
          if (running) {
            activeSessionId = id
            emit({ kind: 'status', action: 'think', text: '' })
          } else {
            emit({ kind: 'status', action: 'idle', text: '' })
          }
          publishState()
        } catch (error) {
          log('warn', `处理 agent/status 失败：${String((error && error.message) || error)}`)
        }
      })
    )
  } catch (error) {
    log('warn', `无法监听 agent/status：${String((error && error.message) || error)}`)
  }

  try {
    disposers.push(
      ctx.on('agent/error', (payload) => {
        try {
          const id = payload && payload.agent && payload.agent.id ? String(payload.agent.id) : 'default'
          ensure(id).running = false
          emit({ kind: 'error', action: 'error', text: '这下真出错了…' })
          publishState()
        } catch (error) {
          log('warn', `处理 agent/error 失败：${String((error && error.message) || error)}`)
        }
      })
    )
  } catch (error) {
    log('warn', `无法监听 agent/error：${String((error && error.message) || error)}`)
  }

  try {
    disposers.push(
      ctx.on('session/disposed', (session) => {
        const id = session && session.id ? String(session.id) : ''
        if (!id) return
        sessions.delete(id)
        if (activeSessionId === id) {
          activeSessionId = null
          publishState()
        }
      })
    )
  } catch (error) {
    log('warn', `无法监听 session/disposed：${String((error && error.message) || error)}`)
  }

  return {
    snapshot,
    dispose() {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch (error) {
          // 卸载期间的失败不值得刷日志
        }
      }
      sessions.clear()
    }
  }
}
