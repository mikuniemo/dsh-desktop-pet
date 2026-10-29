/**
 * 工具名 → 桌宠演出动作的映射。
 *
 * 桌宠端只需要认识一组稳定的 action 名；这里把 DSH 的工具名、会话事件
 * 翻译成 action + 台词。台词短，因为气泡只有一两行宽。
 */

/** 桌宠端实现的 action（和 pet/src/shared/types.ts 的 PetAction 对齐）。 */
export const ACTIONS = Object.freeze([
  'idle',
  'think',
  'read',
  'write',
  'run',
  'web',
  'ask',
  'multi',
  'plan',
  'done',
  'error',
  'eat',
  'sleep'
])

const TOOL_RULES = [
  { match: /^(read|read_image|glob|grep|list_pruned|recall|recall_detail|recall_summary|recall_pruned|lsp)$/i, action: 'read', text: '翻文件看看…' },
  { match: /^(write|edit)$/i, action: 'write', text: '动手改代码…' },
  { match: /^(bash|pwsh|run_code|shell|terminal_open|terminal_read|terminal_signal|job_output|job_kill)$/i, action: 'run', text: '跑命令…' },
  { match: /^(web_search|web_fetch|read_page|x_search|mcp_)/i, action: 'web', text: '上网查一下…' },
  { match: /^(ask_user_question|user_questions)$/i, action: 'ask', text: '在等你回话哦…' },
  { match: /^(subagent|subagent_fork|spawn_teammate|send_message|workflow|team_task_|wait_agent|list_agents|interrupt_agent)$/i, action: 'multi', text: '叫上小伙伴…' },
  { match: /^(todo_write|create_goal|update_goal|get_goal)$/i, action: 'plan', text: '理一下计划…' },
  { match: /^(present|skill|mcp_|cordis_)/i, action: 'plan', text: '摆弄工具…' }
]

/**
 * 按工具名取演出动作。
 * @param {string} name 工具名
 * @returns {{action: string, text: string}}
 */
export function actForTool(name) {
  const tool = String(name || '').trim()
  for (const rule of TOOL_RULES) {
    if (rule.match.test(tool)) return { action: rule.action, text: rule.text }
  }
  return { action: 'write', text: '忙起来了…' }
}

/** 会话状态 → 头顶气泡的语调。 */
export function toneForAction(action) {
  switch (action) {
    case 'done':
      return 'happy'
    case 'error':
      return 'angry'
    case 'ask':
      return 'remind'
    case 'sleep':
      return 'sleepy'
    default:
      return 'normal'
  }
}

/** turn/end 的 reason → 动作。 */
export function actForTurnEnd(reason) {
  const kind = reason && typeof reason === 'object' ? String(reason.kind || '') : String(reason || '')
  if (kind === 'error' || kind === 'aborted' || kind === 'max-tokens') {
    return { action: 'error', text: kind === 'max-tokens' ? '话没说完…' : '出岔子了…' }
  }
  return { action: 'done', text: '搞定！' }
}

/** 把 token 数压成头顶能看懂的短串。 */
export function formatTokens(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return ''
  if (number < 1000) return String(Math.round(number))
  if (number < 1000000) return `${(number / 1000).toFixed(number < 10000 ? 2 : 1)}k`
  return `${(number / 1000000).toFixed(2)}M`
}
