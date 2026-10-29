/**
 * 桌宠画面。
 *
 * 状态来源只有两条：主进程推来的快照（设置 + 会话）和主进程推来的演出指令。
 * 本地只额外保留"用户正在拖/点/投喂"和若干"自己找事"的小动作。
 *
 * 演出由三部分叠成：
 *   1. 姿态  pose = { mode, view, flip }  —— 换视图 + 换 CSS 动画
 *   2. 道具  prop                          —— 头顶飘一个 📖 ⌨️ ⚡ 💭 …
 *   3. 特效  effect                        —— 爱心 / 头晕 / 星星 / 纸屑 / Zzz
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type {
  ActionId,
  BubbleTone,
  FoodPayload,
  PetAct,
  PetAction,
  PetSettings,
  PetSnapshot,
  SoundId
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { CharacterView } from './characters/CharacterView'
import type { WhalePose } from './characters/WhaleGirl'

interface BubbleState {
  text: string
  tone: BubbleTone
  key: number
}

type FoodState = FoodPayload & { key: number; ext: string }

type EffectKind = 'dizzy' | 'hearts' | 'sparkles' | 'crumbs' | 'zzz'

/** 一个动作的完整"表演配方"。 */
interface ActLook {
  mode: ActionId
  view: WhalePose['view']
  flip?: boolean
  prop: string
  /** 停留多久回到待机；0 = 保持到下一条指令。 */
  hold: number
}

const ACTION_LOOK: Record<PetAction, ActLook> = {
  idle: { mode: 'idle', view: 'front', prop: '', hold: 0 },
  think: { mode: 'think', view: 'front', prop: '💭', hold: 7000 },
  read: { mode: 'work', view: 'side', prop: '📖', hold: 5000 },
  write: { mode: 'work', view: 'side', flip: true, prop: '⌨️', hold: 5000 },
  run: { mode: 'walk', view: 'side', prop: '⚡', hold: 5000 },
  web: { mode: 'work', view: 'front', prop: '🌐', hold: 5000 },
  ask: { mode: 'think', view: 'front', prop: '❓', hold: 0 },
  multi: { mode: 'walk', view: 'side', flip: true, prop: '✨', hold: 5000 },
  plan: { mode: 'think', view: 'front', prop: '📝', hold: 5000 },
  done: { mode: 'click', view: 'front', prop: '✅', hold: 2000 },
  error: { mode: 'angry', view: 'front', prop: '💢', hold: 2600 },
  eat: { mode: 'eat', view: 'front', prop: '🍙', hold: 2800 },
  sleep: { mode: 'sleep', view: 'back', prop: '💤', hold: 0 }
}

const IDLE_POSE: WhalePose = { mode: 'idle', view: 'front', flip: false }

/** 没人理的时候自己找的小动作。 */
const ACCENTS: Array<{ name: string; view: WhalePose['view']; flip?: boolean; ms: number }> = [
  { name: 'hop', view: 'front', ms: 900 },
  { name: 'look', view: 'side', flip: true, ms: 1500 },
  { name: 'look', view: 'side', flip: false, ms: 1500 },
  { name: 'wave', view: 'front', ms: 1500 },
  { name: 'stretch', view: 'front', ms: 1600 },
  { name: 'shy', view: 'front', ms: 1300 }
]

const IDLE_LINES = ['嗯…', '要不要喝点水？', '我一直在这儿哦', '这个需求有点意思', '摸摸我嘛', '写代码记得存盘']
const HUNGRY_LINES = ['肚子有点空…', '饿了…拖个文件给我？', '想吃点东西']
const SLEEP_LINES = ['好困…先睡一下', '呼…呼…']

const CLICK_DELAY = 235
const TICK_MS = 5000
const SLEEP_AFTER_MS = 240000
const HUNGER_INTERVAL_MS = 45000

function extensionOf(name: string): string {
  const match = name.match(/\.([a-z0-9]{1,5})$/i)
  return match ? match[1].toUpperCase() : ''
}

export function PetApp() {
  const [snapshot, setSnapshot] = useState<PetSnapshot | null>(null)
  const [pose, setPose] = useState<WhalePose>(IDLE_POSE)
  const [accent, setAccent] = useState<string | null>(null)
  const [prop, setProp] = useState('')
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  const [food, setFood] = useState<FoodState | null>(null)
  const [effect, setEffect] = useState<{ type: EffectKind; key: number } | null>(null)
  const [dropping, setDropping] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [hunger, setHunger] = useState(80)
  const [ready, setReady] = useState(false)

  const snapshotRef = useRef<PetSnapshot | null>(null)
  const poseRef = useRef<WhalePose>(IDLE_POSE)
  const holdTimer = useRef<number | null>(null)
  const accentTimer = useRef<number | null>(null)
  const bubbleTimer = useRef<number | null>(null)
  const effectTimer = useRef<number | null>(null)
  const foodTimer = useRef<number | null>(null)
  const clickTimer = useRef<number | null>(null)
  const downRef = useRef<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)
  const insideRef = useRef(false)
  const idleSinceRef = useRef<number>(Date.now())
  const lastActAtRef = useRef<number>(0)
  const lastLineRef = useRef<string>('')
  const hungerSinceRef = useRef<number>(Date.now())
  const readyRef = useRef(false)

  const settings: PetSettings = snapshot?.settings ?? DEFAULT_SETTINGS
  const settingsRef = useRef<PetSettings>(settings)
  settingsRef.current = settings

  const setPoseSafe = useCallback((next: WhalePose) => {
    poseRef.current = next
    setPose(next)
  }, [])

  const clearTimers = useCallback(() => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current)
    if (accentTimer.current) window.clearTimeout(accentTimer.current)
    holdTimer.current = null
    accentTimer.current = null
    setAccent(null)
  }, [])

  const playSound = useCallback((sound: SoundId) => {
    if (!settingsRef.current.sounds) return
    try {
      const audio = new Audio(`./sounds/${sound}.wav`)
      audio.volume = 0.7
      void audio.play().catch(() => undefined)
    } catch {
      // 没声卡/被策略拦住都无所谓
    }
  }, [])

  const showBubble = useCallback((text: string, tone: BubbleTone, duration: number) => {
    if (!text || !settingsRef.current.showBubble) return
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current)
    setBubble({ text, tone, key: Date.now() })
    bubbleTimer.current = window.setTimeout(() => setBubble(null), duration)
  }, [])

  const showEffect = useCallback((type: EffectKind) => {
    if (settingsRef.current.reduceMotion) return
    if (effectTimer.current) window.clearTimeout(effectTimer.current)
    setEffect({ type, key: Date.now() })
    effectTimer.current = window.setTimeout(() => setEffect(null), 1600)
  }, [])

  /** 回到待机：清姿态、清道具。 */
  const goIdle = useCallback(() => {
    setPoseSafe(IDLE_POSE)
    setProp('')
    idleSinceRef.current = Date.now()
  }, [setPoseSafe])

  /** 应用一条演出指令。 */
  const applyAct = useCallback(
    (act: PetAct) => {
      const action: PetAction = act.action || 'idle'
      const look = ACTION_LOOK[action] ?? ACTION_LOOK.idle

      clearTimers()
      idleSinceRef.current = Date.now()
      lastActAtRef.current = Date.now()

      if (action === 'idle') {
        goIdle()
        return
      }

      setPoseSafe({ mode: look.mode, view: look.view, flip: Boolean(look.flip) })
      setProp(act.prop || look.prop)

      if (act.text) {
        showBubble(act.text, (act.tone as BubbleTone) || 'normal', action === 'error' ? 3200 : 2600)
      }

      if (action === 'done') {
        showEffect('hearts')
        playSound('ding')
      } else if (action === 'error') {
        showEffect('dizzy')
        playSound('oops')
      } else if (action === 'sleep') {
        showEffect('zzz')
        playSound('sleep')
      } else if (action === 'eat') {
        showEffect('crumbs')
        playSound('eat')
      } else if (action === 'multi') {
        showEffect('sparkles')
      } else if (action === 'ask') {
        playSound('ask')
      }

      if (look.hold > 0) {
        holdTimer.current = window.setTimeout(() => goIdle(), look.hold)
      }
    },
    [clearTimers, goIdle, playSound, setPoseSafe, showBubble, showEffect]
  )

  // ---- 与主进程的连接 ----
  useEffect(() => {
    let disposed = false
    const offs = [
      window.petAPI.onSnapshot((next) => {
        snapshotRef.current = next
        setSnapshot(next)
      }),
      window.petAPI.onAct((act) => applyAct(act)),
      // 自己在走路：引擎负责挪窗口，这里只切视图 / 播走路动画
      window.petAPI.onWalk((state) => {
        if (state.walking) {
          setPoseSafe({ mode: 'walk', view: state.view, flip: state.flip })
          return
        }
        if (Date.now() - lastActAtRef.current < 900) return
        setPoseSafe(IDLE_POSE)
      }),
      // 引擎自己找的小动作：蹦 / 摇摆 / 伸懒腰（复用 CSS 的 accent 动画）
      window.petAPI.onMotionAction((action) => {
        if (settingsRef.current.reduceMotion) return
        const table: Record<string, { name: string; ms: number }> = {
          jump: { name: 'hop', ms: 760 },
          sway: { name: 'wave', ms: 1500 },
          stretch: { name: 'stretch', ms: 1700 }
        }
        const pick = table[action]
        if (!pick) return
        if (accentTimer.current) window.clearTimeout(accentTimer.current)
        setAccent(pick.name)
        accentTimer.current = window.setTimeout(() => {
          setAccent(null)
          if (poseRef.current.mode !== 'walk') setPoseSafe(IDLE_POSE)
        }, pick.ms)
      }),
      // 自言自语：inner = 原版那种灰色斜体心声
      window.petAPI.onSay(({ text, inner }) => {
        if (!text || text === lastLineRef.current) return
        lastLineRef.current = text
        showBubble(inner ? `（${text}）` : text, inner ? 'inner' : 'normal', 2800)
      })
    ]

    window.petAPI
      .bootstrap()
      .then((next) => {
        if (disposed) return
        snapshotRef.current = next
        setSnapshot(next)
        setReady(true)
      })
      .catch((error) => console.error('bootstrap failed', error))

    return () => {
      disposed = true
      for (const off of offs) off()
      if (holdTimer.current) window.clearTimeout(holdTimer.current)
      if (accentTimer.current) window.clearTimeout(accentTimer.current)
      if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current)
      if (effectTimer.current) window.clearTimeout(effectTimer.current)
      if (foodTimer.current) window.clearTimeout(foodTimer.current)
      if (clickTimer.current) window.clearTimeout(clickTimer.current)
    }
  }, [applyAct])

  useEffect(() => {
    if (!ready || readyRef.current) return
    readyRef.current = true
    window.petAPI.petReady()
  }, [ready])

  // 光标是否压在宠物身上 → 决定窗口其余部分是否"穿透"。
  useEffect(() => {
    let queued = false
    let lastX = 0
    let lastY = 0

    const update = () => {
      queued = false
      const element = document.elementFromPoint(lastX, lastY)
      const inside = Boolean(element?.closest('.pet-hit'))
      if (inside !== insideRef.current) {
        insideRef.current = inside
        window.petAPI.petPointer(inside)
      }
    }

    const onMove = (event: MouseEvent) => {
      lastX = event.clientX
      lastY = event.clientY
      if (dropping) {
        if (!insideRef.current) {
          insideRef.current = true
          window.petAPI.petPointer(true)
        }
        return
      }
      if (!queued) {
        queued = true
        window.requestAnimationFrame(update)
      }
    }

    const onLeave = () => {
      if (insideRef.current) {
        insideRef.current = false
        window.petAPI.petPointer(false)
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [dropping])

  // ---- 自发行为：闲话、犯困、饿、自己找小动作 ----
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = settingsRef.current
      const now = Date.now()
      const idleFor = now - idleSinceRef.current
      const currentPose = poseRef.current

      if (current.hunger && now - hungerSinceRef.current > HUNGER_INTERVAL_MS) {
        hungerSinceRef.current = now
        setHunger((value) => Math.max(0, value - 3))
      }

      // 走动 / 演出 / 拖拽期间不插嘴，也不抢姿势
      if (currentPose.mode !== 'idle') return
      if (Date.now() < lastActAtRef.current + 1500) return

      // 困到一定程度直接睡（这条是本地加的，原版没有）
      if (current.idleChatter && idleFor > SLEEP_AFTER_MS) {
        applyAct({ action: 'sleep', text: SLEEP_LINES[Math.floor(Math.random() * SLEEP_LINES.length)], tone: 'sleepy' })
        return
      }

      // 饿了会自己嘀咕（说话和随手动作由主进程的运动引擎负责，这里不重复）
      if (current.hunger && hunger < 30 && Math.random() < 0.35) {
        showBubble(HUNGRY_LINES[Math.floor(Math.random() * HUNGRY_LINES.length)], 'remind', 2800)
      }
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [applyAct, hunger, setPoseSafe, showBubble])

  // ---- 指针交互 ----
  const finishPointer = useCallback(
    (event?: ReactPointerEvent<HTMLDivElement>) => {
      if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (!downRef.current) return
      downRef.current = null
      setPressed(false)
      if (draggingRef.current) {
        draggingRef.current = false
        window.petAPI.petDragEnd()
        goIdle()
        return
      }
      if (clickTimer.current) {
        window.clearTimeout(clickTimer.current)
        clickTimer.current = null
        window.petAPI.petDoubleClick()
        return
      }
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = null
        window.petAPI.petClick()
      }, CLICK_DELAY)
    },
    [goIdle]
  )

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    downRef.current = { x: event.screenX, y: event.screenY }
    draggingRef.current = false
    setPressed(true)
    insideRef.current = true
    window.petAPI.petPointer(true)
  }, [])

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!downRef.current || draggingRef.current) return
      const dx = event.screenX - downRef.current.x
      const dy = event.screenY - downRef.current.y
      if (Math.hypot(dx, dy) > 6) {
        draggingRef.current = true
        setPressed(false)
        if (clickTimer.current) {
          window.clearTimeout(clickTimer.current)
          clickTimer.current = null
        }
        clearTimers()
        setPoseSafe({ mode: 'drag', view: 'back', flip: false })
        setProp('🎈')
        playSound('drag')
        window.petAPI.petDragStart()
      }
    },
    [clearTimers, playSound, setPoseSafe]
  )

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishPointer(event)
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const inside = Boolean(element?.closest('.pet-hit'))
      if (inside !== insideRef.current) {
        insideRef.current = inside
        window.petAPI.petPointer(inside)
      }
    },
    [finishPointer]
  )

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishPointer(event)
    },
    [finishPointer]
  )

  // 右键菜单已按要求去掉：所有入口统一走托盘菜单，避免弹出位置不够精准
  // ---- 投喂 ----
  const onDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDropping(true)
    insideRef.current = true
    window.petAPI.petPointer(true)
  }, [])

  const onDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }, [])

  const onDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) setDropping(false)
  }, [])

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDropping(false)
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => {
          try {
            return window.petAPI.getFilePath(file)
          } catch {
            return ''
          }
        })
        .filter(Boolean)
      if (paths.length === 0) return
      void window.petAPI.feedFiles(paths).then((payload) => {
        if (!payload) return
        setHunger(100)
        hungerSinceRef.current = Date.now()
        if (foodTimer.current) window.clearTimeout(foodTimer.current)
        setFood({ ...payload, key: Date.now(), ext: extensionOf(payload.name) })
        foodTimer.current = window.setTimeout(() => setFood(null), 2600)
        applyAct({ action: 'eat', text: '好吃！', tone: 'happy' })
      })
    },
    [applyAct]
  )

  const visualScale = useMemo(() => {
    if (settings.reduceMotion) return settings.scale
    const angryScale = pose.mode === 'angry' ? 1.12 : 1
    return Math.min(1.9, settings.scale * angryScale)
  }, [pose.mode, settings.reduceMotion, settings.scale])

  const rootStyle = useMemo(
    () =>
      ({
        '--s': visualScale,
        '--tilt': 0,
        '--speed': 1
      }) as CSSProperties,
    [visualScale]
  )

  if (!snapshot) return null

  const session = snapshot.session
  const tokenLabel = settings.showTokens ? session.usage.totalLabel : ''
  const balanceInfo = snapshot.balance
  const angry = pose.mode === 'angry'

  return (
    <div className={`pet-root ${dropping ? 'is-dropping' : ''} ${hunger < 30 ? 'is-hungry' : ''}`} style={rootStyle}>
      {tokenLabel ? (
        <div className={`token-badge ${session.running ? 'is-live' : ''}`} title="本次会话累计 token">
          <span className="token-badge-whale" aria-hidden="true">
            🐋
          </span>
          <span className="token-badge-dot" />
          {tokenLabel}
          {balanceInfo ? (
            <span className={`balance-chip ${balanceInfo.low ? 'is-low' : ''}`} title="DeepSeek 账户余额">
              💰{balanceInfo.amount.toFixed(2)}
            </span>
          ) : null}
        </div>
      ) : null}

      {bubble && (
        <div key={bubble.key} className={`speech-bubble tone-${bubble.tone}`}>
          <span>{bubble.text}</span>
        </div>
      )}

      <div className={`pet-anchor mode-${pose.mode} ${accent ? `accent-${accent}` : ''}`}>
        <span className="pet-halo" aria-hidden="true" />
        <span className="pet-ground-shadow" aria-hidden="true" />
        <span className="pet-drag-shadow" aria-hidden="true" />
        {prop ? (
          <div className="act-prop" key={`${prop}-${pose.mode}`} aria-hidden="true">
            {prop}
          </div>
        ) : null}
        <div className="pet-tilt">
          <div className="pet-bob">
            <div className="pet-facing">
              <div
                className={`pet-hit ${pressed ? 'is-pressed' : ''} ${dropping ? 'is-drop-target' : ''}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                onDragEnter={onDragEnter}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <CharacterView character={settings.character} pose={pose} hungry={hunger < 30} />
              </div>
            </div>
          </div>
        </div>
        {food && <FoodSnack food={food} />}
      </div>

      {dropping && <div className="drop-hint">松手喂给我～</div>}
      {angry && <div className="anger-puff" aria-hidden="true" />}
      {effect && <EffectLayer effect={effect} />}
    </div>
  )
}

const DOC_TINTS: Record<string, string> = {
  PNG: '#4a9fe0',
  JPG: '#e5a53f',
  JPEG: '#e5a53f',
  GIF: '#c77ae0',
  WEBP: '#7fbf5a',
  PDF: '#df5b50',
  DOC: '#4b7fd6',
  DOCX: '#4b7fd6',
  XLS: '#4caf74',
  XLSX: '#4caf74',
  PPT: '#e07a44',
  PPTX: '#e07a44',
  TXT: '#8b9aa8',
  ZIP: '#b98a4a',
  RAR: '#b98a4a',
  '7Z': '#b98a4a',
  MP3: '#e07ab0',
  WAV: '#e07ab0',
  MP4: '#7d8be0',
  MOV: '#7d8be0',
  EXE: '#7b8794'
}

const CRUMBS = [
  { x: -20, delay: 0.74, size: 5 },
  { x: 16, delay: 1.14, size: 4 },
  { x: -8, delay: 1.54, size: 6 },
  { x: 24, delay: 1.9, size: 4 }
]

function FoodSnack({ food }: { food: FoodState }) {
  const tint = DOC_TINTS[food.ext] ?? '#d49a54'
  return (
    <div className="food-snack" key={food.key} aria-hidden="true">
      <div className="food-doc" style={{ '--doc-tint': tint } as CSSProperties}>
        <span className="food-fold" />
        {food.icon ? (
          <img className="food-icon" src={food.icon} alt="" draggable={false} />
        ) : (
          <span className="food-ext">{food.ext || 'FILE'}</span>
        )}
        {food.count > 1 && <span className="food-count">×{food.count}</span>}
      </div>
      <span className="food-name">{food.name}</span>
      {CRUMBS.map((crumb, index) => (
        <span
          key={index}
          className="food-crumb"
          style={
            {
              '--crumb-x': `${crumb.x}px`,
              '--crumb-delay': `${crumb.delay}s`,
              '--crumb-size': `${crumb.size}px`
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

function EffectLayer({ effect }: { effect: { type: EffectKind; key: number } }) {
  const particles = useMemo(() => {
    const count = effect.type === 'zzz' ? 3 : effect.type === 'dizzy' ? 4 : 6
    return Array.from({ length: count }, (_, index) => ({
      index,
      x: Math.cos((index / count) * Math.PI * 2) * (30 + (index % 3) * 12),
      delay: index * 0.07,
      size: 12 + ((index * 7) % 10)
    }))
  }, [effect.key, effect.type])

  const glyph =
    effect.type === 'hearts'
      ? ['💛', '💕', '💗', '✨']
      : effect.type === 'sparkles'
        ? ['✨', '⭐', '💫']
        : effect.type === 'zzz'
          ? ['z', 'Z', 'z']
          : effect.type === 'crumbs'
            ? ['●', '·', '•']
            : ['✦', '★', '✧']

  return (
    <div className={`fx-layer fx-${effect.type}`} key={effect.key}>
      {particles.map((particle) => (
        <span
          key={particle.index}
          className="fx-particle"
          style={
            {
              '--fx-x': `${particle.x}px`,
              '--fx-delay': `${particle.delay}s`,
              '--fx-size': `${particle.size}px`
            } as CSSProperties
          }
        >
          {glyph[particle.index % glyph.length]}
        </span>
      ))}
    </div>
  )
}
