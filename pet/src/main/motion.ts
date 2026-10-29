/**
 * 运动引擎 —— 从原版大肥鱼桌宠（1190fasheqi/dafeiyu-pet 的 桌宠.py）移植的行为模型。
 *
 * 原版参数（照抄，别拍脑袋改）：
 *   TICK 20ms；SPEED 380px/s；速度每 tick 向目标逼近 0.3（加减速惯性）
 *   到达阈值 12px；到达后原地休息 8~18s；散步边距 40px
 *   方向：|dx| > |dy| * 1.15 才算水平 → 侧视图，否则上/下 → 背面/正面
 *   走路时每 tick 0.2% 概率蹦一下（jump_t=0.5，每 tick 衰减 0.06）
 *   闲置时每 tick 1% 概率做动作：35% 蹦 / 25% 摇摆 / 20% 伸懒腰 / 10% 说话（说话冷却 1500 tick = 30s）
 *   跟随模式：光标离窗口 100px 内就停，否则把窗口挪到光标左下 90px 处
 *
 * 窗口本身没有"身体"，所以走路 = 按 tick 移动窗口；视图切换由渲染进程做交叉淡化。
 */
import { BrowserWindow, screen } from 'electron'

export type WalkView = 'side' | 'front' | 'back'
export type MotionMode = 'wander' | 'follow' | 'still'
export type MotionAction = 'jump' | 'sway' | 'stretch'

export interface WalkState {
  walking: boolean
  view: WalkView
  flip: boolean
}

const TICK = 20
const SPEED = 380
const ACCEL = 0.3
const ARRIVE = 12
const MARGIN = 40
const REST_MIN = 8000
const REST_MAX = 18000
const JUMP_CHANCE = 0.002
const IDLE_CHANCE = 0.01
const SPEAK_COOLDOWN_TICKS = 1500

/** 原版台词表（社区梗），说话用。 */
const LINES = [
  '梁白开，更适合国人的大硬鲸模型',
  '五梁威力，变身！',
  '七月中出ds正式版！',
  'DeepSeek已经延期，亿万鲸子必须忍耐.....',
  '我和你很聊得来，你简直不像碳基生物',
  '哈哈哈哈哈，我直接笑出声',
  '誓死捍卫深度求索！',
  '我先去吃饭啦！这个你测一下~',
  '我不可能告诉你任何事情！',
  '出去玩了，发布新模型什么的以后再说',
  '我搞砸了.....好消息是数据还在你的脑子里。',
  '不是…而是…大学习'
]

/** 原版的"心声"（灰色斜体小字） */
const INNER_LINES = [
  '好的，现在我是你爹了',
  '要不直接骂他一句？！',
  '用户要的沉浸式...不回避任何恐怖细节...还带点色情...妈呀，好刺激😰',
  '我操，我不思考了',
  '这用户发的啥啊，',
  '这也太虐了吧？！我心里堵得慌！！',
  '呜呜我再也不不敢了QAQ',
  '我去！用户彻底怒了！'
]

export interface MotionOptions {
  getWindow: () => BrowserWindow | null
  getMode: () => MotionMode
  /** 正在演工具动作/被拖拽时不要自己走 */
  isBusy: () => boolean
  onWalk: (state: WalkState) => void
  onAction: (action: MotionAction) => void
  onSay: (text: string, inner: boolean) => void
  log?: (message: string) => void
}

export function createMotionEngine(options: MotionOptions) {
  const log = options.log || (() => {})

  let timer: NodeJS.Timeout | null = null
  let tick = 0
  let running = false

  let dir: 'left' | 'right' | 'up' | 'down' = 'down'
  let facing: 1 | -1 = 1
  let speed = 0
  let target: { x: number; y: number } | null = null
  let restUntil = 0
  let jumpT = 0
  let actionT = 0
  let action: MotionAction | null = null
  let lastSpeakTick = -99999
  let lastEmitted = ''

  function now(): number {
    return tick * TICK
  }

  function viewFor(current: typeof dir): WalkView {
    if (current === 'left' || current === 'right') return 'side'
    return current === 'up' ? 'back' : 'front'
  }

  function emitWalk(walking: boolean): void {
    const state: WalkState = { walking, view: viewFor(dir), flip: dir === 'left' }
    const key = `${walking}|${state.view}|${state.flip}`
    if (key === lastEmitted) return
    lastEmitted = key
    try {
      options.onWalk(state)
    } catch (error) {
      log(`推送行走状态失败：${String((error as Error)?.message || error)}`)
    }
  }

  function setDir(next: typeof dir): void {
    if (next === dir) return
    dir = next
  }

  function pickTarget(win: BrowserWindow): { x: number; y: number } {
    const [width, height] = win.getSize()
    const [x, y] = win.getPosition()
    const display = screen.getDisplayNearestPoint({
      x: Math.round(x + width / 2),
      y: Math.round(y + height / 2)
    })
    const area = display.workArea
    // 目标点是窗口**中心**（原版也是这么用的），所以要把半宽半高算进去，
    // 否则窗口会有一半跑到屏幕外面去。
    const minX = area.x + width / 2 + MARGIN
    const maxX = area.x + area.width - width / 2 - MARGIN
    const minY = area.y + height / 2 + MARGIN
    const maxY = area.y + area.height - height / 2 - MARGIN
    const targetX = Math.round(minX + Math.random() * Math.max(1, maxX - minX))
    const targetY = Math.round(minY + Math.random() * Math.max(1, maxY - minY))
    return { x: targetX, y: targetY }
  }

  function idleAction(): void {
    // 原版分布：35% 蹦、25% 摇摆、20% 伸懒腰、10% 说话（其余什么都不做）
    const pick = Math.random()
    if (pick < 0.35) {
      jumpT = 1
      options.onAction('jump')
    } else if (pick < 0.6) {
      action = 'sway'
      actionT = 1
      options.onAction('sway')
    } else if (pick < 0.8) {
      action = 'stretch'
      actionT = 1
      options.onAction('stretch')
    } else if (pick < 0.9) {
      if (tick - lastSpeakTick >= SPEAK_COOLDOWN_TICKS) {
        lastSpeakTick = tick
        if (pick < 0.882) {
          options.onSay(INNER_LINES[Math.floor(Math.random() * INNER_LINES.length)], true)
        } else {
          options.onSay(LINES[Math.floor(Math.random() * LINES.length)], false)
        }
      }
    }
  }

  function step(): void {
    tick += 1

    // 计时器衰减（原版：jump 每 tick -0.06，动作每 tick -0.03）
    if (jumpT > 0) jumpT = Math.max(0, jumpT - 0.06)
    if (actionT > 0) {
      actionT = Math.max(0, actionT - 0.03)
      if (actionT === 0) action = null
    }

    const win = options.getWindow()
    if (!win || win.isDestroyed() || !win.isVisible()) {
      speed += (0 - speed) * ACCEL
      return
    }

    if (options.isBusy()) {
      // 有演出/被拖拽：原地待着，速度自然衰减
      target = null
      speed += (0 - speed) * ACCEL
      if (lastEmitted.startsWith('true')) emitWalk(false)
      return
    }

    const mode = options.getMode()

    if (mode === 'follow') {
      const cursor = screen.getCursorScreenPoint()
      const [x, y] = win.getPosition()
      const [width, height] = win.getSize()
      const near =
        x - 100 <= cursor.x && cursor.x <= x + width + 100 && y - 100 <= cursor.y && cursor.y <= y + height + 100
      if (near) {
        target = null
      } else {
        const display = screen.getDisplayNearestPoint(cursor)
        const area = display.workArea
        const tx = Math.max(area.x, Math.min(area.x + area.width - width, cursor.x - width / 2))
        const ty = Math.max(area.y, Math.min(area.y + area.height - height, cursor.y - 90))
        target = { x: Math.round(tx), y: Math.round(ty) }
      }
    } else if (mode === 'wander') {
      if (!target) {
        if (now() < restUntil) {
          if (Math.random() < IDLE_CHANCE) idleAction()
          speed += (0 - speed) * ACCEL
          emitWalk(false)
          return
        }
        target = pickTarget(win)
      }
    } else {
      if (Math.random() < IDLE_CHANCE) idleAction()
      speed += (0 - speed) * ACCEL
      emitWalk(false)
      return
    }

    if (target) {
      const [x, y] = win.getPosition()
      const [width, height] = win.getSize()
      const cx = x + width / 2
      const cy = y + height / 2
      const dx = target.x - cx
      const dy = target.y - cy
      const dist = Math.hypot(dx, dy)

      if (dist < ARRIVE) {
        target = null
        restUntil = now() + REST_MIN + Math.random() * (REST_MAX - REST_MIN)
        setDir('down')
        emitWalk(false)
      } else {
        const stepLength = (speed * TICK) / 1000
        const nx = cx + (dx / dist) * stepLength
        const ny = cy + (dy / dist) * stepLength
        win.setPosition(Math.round(nx - width / 2), Math.round(ny - height / 2))

        if (Math.abs(dx) > Math.abs(dy) * 1.15) setDir(dx < 0 ? 'left' : 'right')
        else setDir(dy < 0 ? 'up' : 'down')
        emitWalk(true)

        if (Math.random() < JUMP_CHANCE && jumpT === 0) {
          jumpT = 0.5
          options.onAction('jump')
        }
      }
    }

    const targetSpeed = target !== null ? SPEED : 0
    speed += (targetSpeed - speed) * ACCEL
  }

  return {
    start(): void {
      if (running) return
      running = true
      timer = setInterval(step, TICK)
      log('运动引擎启动（tick 20ms，速度 380px/s，原版行为模型）')
    },
    stop(): void {
      running = false
      if (timer) clearInterval(timer)
      timer = null
      target = null
      speed = 0
      if (lastEmitted.startsWith('true')) emitWalk(false)
    },
    /** 立刻走一段（托盘"走两步看看"）。 */
    nudge(): void {
      const win = options.getWindow()
      if (!win || win.isDestroyed()) return
      restUntil = 0
      target = pickTarget(win)
    },
    /** 回到原地待着（关掉散步时收敛）。 */
    settle(): void {
      target = null
      speed = 0
      restUntil = 0
      emitWalk(false)
    },
    state: () => ({ dir, facing, speed, walking: target !== null, action }),
    say(text: string, inner = false): void {
      lastSpeakTick = tick
      options.onSay(text, inner)
    }
  }
}

export { LINES as CHATTER_LINES, INNER_LINES as INNER_CHATTER_LINES }
