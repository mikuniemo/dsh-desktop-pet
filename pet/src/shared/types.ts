/** 桌宠与插件之间共享的类型。插件侧的 lib/store.js、lib/actions.js 与此保持同步。 */

/** 插件推来的语义动作。 */
export type PetAction =
  | 'idle'
  | 'think'
  | 'read'
  | 'write'
  | 'run'
  | 'web'
  | 'ask'
  | 'multi'
  | 'plan'
  | 'done'
  | 'error'
  | 'eat'
  | 'sleep'

/** 形象渲染用的姿态（CSS 类 mode-<x>）。 */
export type ActionId =
  | 'idle'
  | 'walk'
  | 'click'
  | 'drag'
  | 'angry'
  | 'eat'
  | 'sleep'
  | 'wake'
  | 'think'
  | 'work'

export type CharacterId = 'whale' | 'cat' | 'ghost' | 'slime'

export const CHARACTERS: Array<{ id: CharacterId; name: string }> = [
  { id: 'whale', name: '鲸鱼娘' },
  { id: 'cat', name: '橘子' },
  { id: 'ghost', name: '小幽' },
  { id: 'slime', name: '果冻' }
]

export interface PetSettings {
  followTools: boolean
  showBubble: boolean
  showTokens: boolean
  sounds: boolean
  character: CharacterId
  scale: number
  clickThrough: boolean
  alwaysOnTop: boolean
  reduceMotion: boolean
  idleChatter: boolean
  hunger: boolean
  visible: boolean
  /** 双击「打开 DSH」时用桌宠自己的窗口（true）还是浏览器标签（false）。 */
  guiInAppWindow: boolean
  /** 行动模式：自由散步 / 跟着鼠标跑 / 原地待着。 */
  motionMode: MotionMode
  /** 任务完成/花费/token 播报。 */
  notifyTurn: boolean
  /** 余额不足提醒（"饿饿…喂喂…"）。 */
  balanceWarn: boolean
}

export const DEFAULT_SETTINGS: PetSettings = {
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
}

/** 行动模式（照原版大肥鱼：自由散步 / 跟随鼠标 / 原地待着）。 */
export type MotionMode = 'wander' | 'follow' | 'still'

/** 运动引擎自己找的小动作。 */
export type MotionAction = 'jump' | 'sway' | 'stretch'

/** 行走状态：视图 + 是否镜像。 */
export interface WalkState {
  walking: boolean
  view: 'side' | 'front' | 'back'
  flip: boolean
}

export interface SessionInfo {
  sessionId: string | null
  title: string
  turn: number
  running: boolean
  usage: { input: number; output: number; total: number; totalLabel: string; turn: number }
}

export const EMPTY_SESSION: SessionInfo = {
  sessionId: null,
  title: '',
  turn: 0,
  running: false,
  usage: { input: 0, output: 0, total: 0, totalLabel: '', turn: 0 }
}

export interface PetSnapshot {
  settings: PetSettings
  session: SessionInfo
  /** 余额（插件可拿到时才有）；low = 低于阈值。 */
  balance: BalanceInfo | null
  version: string
  dataDir: string
  bellyDir: string
  bridge: { connected: boolean; port: number }
  pid: number
}

/** 账户余额（由插件向 Host 的 deepseekAccount 服务查询，拿不到就是 null）。 */
export interface BalanceInfo {
  amount: number
  currency: string
  low: boolean
  /** 上一轮的花费（同一个货币），拿不到就是 null。 */
  lastCost: number | null
  updatedAt: number
}

export type BubbleTone = 'normal' | 'happy' | 'angry' | 'sleepy' | 'remind' | 'inner'

/** 插件推来的一次演出。 */
export interface PetAct {
  kind?: string
  action: PetAction
  text?: string
  tone?: BubbleTone
  /** 覆盖默认头顶道具（插件想指定 🍚/💰 时用）。 */
  prop?: string
  tool?: string
  ok?: boolean
  ms?: number
  at?: number
}

export type PetCommand =
  | 'show'
  | 'hide'
  | 'reset-position'
  | 'quit'
  | 'reload'
  | 'pat'
  | 'wave'
  // 试演：只放一次对应动作，用来在设置页/调试时看效果
  | 'error'
  | 'sleep'
  | 'eat'
  | 'think'
  | 'work'
  | 'done'
  /** 打开/聚焦 DSH 界面窗口（DSH 启动脚本也会调它）。 */
  | 'open-gui'

export interface FoodPayload {
  name: string
  count: number
  icon?: string
  skipped?: number
}

export type SoundId =
  | 'click'
  | 'drag'
  | 'angry'
  | 'eat'
  | 'sleep'
  | 'wake'
  | 'drop'
  | 'remind'
  // 柔和版提示音（自制）：报错 / 完成 / 等你回答
  | 'oops'
  | 'ding'
  | 'ask'

export interface PetApi {
  bootstrap(): Promise<PetSnapshot>
  getFilePath(file: File): string
  petReady(): void
  petPointer(inside: boolean): void
  petDragStart(): void
  petDragEnd(): void
  petClick(): void
  petDoubleClick(): void
  feedFiles(paths: string[]): Promise<FoodPayload | null>
  setCharacter(id: CharacterId): void
  openBelly(): void
  quit(): void
  onSnapshot(cb: (snapshot: PetSnapshot) => void): () => void
  onAct(cb: (act: PetAct) => void): () => void
  onCommand(cb: (command: PetCommand) => void): () => void
  /** 自己在走路（换视图 + 走路动画）。 */
  onWalk(cb: (state: WalkState) => void): () => void
  /** 自己找的小动作：蹦 / 摇摆 / 伸懒腰。 */
  onMotionAction(cb: (action: MotionAction) => void): () => void
  /** 自言自语（inner = 灰色斜体心声）。 */
  onSay(cb: (payload: { text: string; inner: boolean }) => void): () => void
}
