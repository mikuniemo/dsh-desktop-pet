/**
 * dsh-desktop-pet —— Client 半：设置 → 「桌宠」页。
 *
 * 页面只做三件事：读出桥接地址、把设置写回 Host、遥控桌宠本体。
 * 端口和 token 由 Host 通过 `webserver/index-inject` 注入到
 * `window.__DSH_DESKTOP_PET__`；取不到就退回 localStorage 里上一次的地址，
 * 再取不到就明确告诉用户"重启一次 DSH"，不做静默失败。
 *
 * 不依赖 configForms / 任何 Harness Client 包：这个插件的运行时设置由
 * Host 的 settings.json 拥有，页面通过本机 HTTP 读写它。
 */
window.__ModuleLoader__.load({
  id: 'dsh-desktop-pet',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-desktop-pet'
    const CACHE_KEY = 'dsh-desktop-pet/bridge'
    const POLL_MS = 4000

    const ZH = {
      'nav.title': '桌宠',
      'page.title': '桌宠',
      'page.subtitle': '一只住在桌面上的小家伙，会跟着我干活。',
      'status.online': '已连接',
      'status.offline': '未连接',
      'status.connecting': '连接中…',
      'bridge.missing': '读不到桥接信息，桌宠插件可能没有生效。重启一次 DSH 再回来。',
      'bridge.down': '连不上桌宠桥接服务，插件可能正在重启。',
      'pet.title': '桌宠本体',
      'pet.hint': '桌面程序是独立窗口；关掉它只影响显示，插件照常在跑。',
      'row.character': '角色',
      'row.scale': '大小',
      'row.followTools': '跟着工具调用演出',
      'row.followToolsHint': '思考、读文件、跑命令、报错、完成，各有动作和台词。',
      'row.behaviourTitle': '联动与行为',
      'row.motionTitle': '行动模式',
      'motion.wander': '自由散步',
      'motion.follow': '跟着鼠标跑',
      'motion.still': '原地待着',
      'motion.hint': '照原版大肥鱼的行为：自由散步会到处走、上下用正/背面；跟着鼠标会在光标附近跟着挪；原地待着只做小动作。',
      'row.showBubble': '说话气泡',
      'row.showTokens': '头顶显示 token 消耗',
      'row.sounds': '音效',
      'row.clickThrough': '鼠标穿透',
      'row.clickThroughHint': '开启后点击会穿到下面的窗口，只能从托盘菜单关掉。',
      'row.alwaysOnTop': '始终置顶',
      'row.reduceMotion': '减少动效',
      'row.idleChatter': '闲着自己搭话',
      'row.idleChatterHint': '长时间没人理它，会自己嘀咕、犯困、睡觉。',
      'row.hunger': '会饿',
      'row.hungerHint': '饿了会提醒你，拖个文件给它吃就恢复了。',
      'row.guiInAppWindow': 'DSH 开在独立窗口里',
      'row.guiInAppWindowHint': '双击宠物打开 DSH 时用桌宠自己的窗口（再次双击只聚焦，不会越开越多）；关掉则回到浏览器标签。',
      'row.notifyTurn': '每轮播报 token / 花费',
      'row.notifyTurnHint': '一轮结束时冒一句"这轮 xx k · -¥0.0x"（花费靠余额差算，查不到余额就只报 token）。',
      'row.balanceWarn': '余额不足提醒',
      'row.balanceWarnHint': '余额低于 ¥5 时喊"饿饿…喂喂…"，半小时最多一次。',
      'char.whale': '鲸鱼娘（大肥鱼）',
      'char.cat': '橘子（橘猫）',
      'char.ghost': '小幽（幽灵）',
      'char.slime': '果冻（史莱姆）',
      'action.show': '叫出来',
      'action.hide': '藏起来',
      'action.reset': '回到默认位置',
      'action.say': '让它说句话',
      'preview.title': '试演动作',
      'preview.hint': '只是让它演一下，不影响正在跑的任务。',
      'preview.done': '开心',
      'preview.work': '干活',
      'preview.error': '报错',
      'preview.sleep': '睡觉',
      'state.saved': '已保存',
      'state.failed': '保存失败',
      'state.session': '当前会话',
      'state.noSession': '还没有会话',
      'state.tokens': '本次会话累计 token',
      'state.petPid': '桌面进程'
    }

    const EN = {
      'nav.title': 'Desktop Pet',
      'page.title': 'Desktop Pet',
      'page.subtitle': 'A little creature living on your desktop, keeping up with the work.',
      'status.online': 'Connected',
      'status.offline': 'Not connected',
      'status.connecting': 'Connecting…',
      'bridge.missing': 'No bridge information found. The pet plugin may not be active — restart DSH and come back.',
      'bridge.down': 'Cannot reach the pet bridge; the plugin may be restarting.',
      'pet.title': 'The pet',
      'pet.hint': 'The desktop pet is a standalone window. Closing it only hides the pet; the plugin keeps running.',
      'row.character': 'Character',
      'row.scale': 'Size',
      'row.followTools': 'Act out tool calls',
      'row.followToolsHint': 'Thinking, reading, running commands, errors and completions each get their own pose and line.',
      'row.behaviourTitle': 'Behaviour',
      'row.motionTitle': 'Movement',
      'motion.wander': 'Free roam',
      'motion.follow': 'Follow cursor',
      'motion.still': 'Stay put',
      'motion.hint': 'Same model as the original dafeiyu pet: free roam walks around (front/back views for vertical), follow cursor trails the pointer, stay put only does idle fidgets.',
      'row.showBubble': 'Speech bubble',
      'row.showTokens': 'Token usage overhead',
      'row.sounds': 'Sounds',
      'row.clickThrough': 'Click-through',
      'row.clickThroughHint': 'Clicks pass to the window below. Turn it off from the tray menu.',
      'row.alwaysOnTop': 'Always on top',
      'row.reduceMotion': 'Reduce motion',
      'row.idleChatter': 'Idle chatter',
      'row.idleChatterHint': 'When ignored for a while it mutters, dozes off and sleeps.',
      'row.hunger': 'Gets hungry',
      'row.hungerHint': 'It reminds you when hungry; drop a file on it to feed it.',
      'row.guiInAppWindow': 'Open DSH in its own window',
      'row.guiInAppWindowHint': 'Double-clicking the pet opens DSH in a pet-owned window (a second double-click only focuses it). Turn off to use a browser tab again.',
      'row.notifyTurn': 'Report tokens / cost each turn',
      'row.notifyTurnHint': 'At the end of a turn it says "this turn xx k · -¥0.0x" (cost is inferred from the balance delta; without balance it reports tokens only).',
      'row.balanceWarn': 'Low balance warning',
      'row.balanceWarnHint': 'Below ¥5 it whines "hungry… feed me…" at most once every 30 minutes.',
      'char.whale': 'Whale Girl (Dafeiyu)',
      'char.cat': 'Juzi (orange cat)',
      'char.ghost': 'Xiaoyou (ghost)',
      'char.slime': 'Jelly (slime)',
      'action.show': 'Show pet',
      'action.hide': 'Hide',
      'action.reset': 'Reset position',
      'action.say': 'Make it talk',
      'preview.title': 'Preview a pose',
      'preview.hint': 'Just a preview; it does not touch the running task.',
      'preview.done': 'Happy',
      'preview.work': 'Working',
      'preview.error': 'Error',
      'preview.sleep': 'Sleeping',
      'state.saved': 'Saved',
      'state.failed': 'Save failed',
      'state.session': 'Session',
      'state.noSession': 'No session yet',
      'state.tokens': 'Session tokens',
      'state.petPid': 'Desktop process'
    }

    const CHARACTERS = [
      { id: 'whale', emoji: '🐋' },
      { id: 'cat', emoji: '🐱' },
      { id: 'ghost', emoji: '👻' },
      { id: 'slime', emoji: '🫧' }
    ]

    const BOOLEAN_ROWS = [
      { key: 'followTools', hint: 'row.followToolsHint' },
      { key: 'showBubble' },
      { key: 'showTokens' },
      { key: 'sounds' },
      { key: 'alwaysOnTop' },
      { key: 'reduceMotion' },
      { key: 'idleChatter', hint: 'row.idleChatterHint' },
      { key: 'hunger', hint: 'row.hungerHint' },
      { key: 'guiInAppWindow', hint: 'row.guiInAppWindowHint' },
      { key: 'notifyTurn', hint: 'row.notifyTurnHint' },
      { key: 'balanceWarn', hint: 'row.balanceWarnHint' },
      { key: 'clickThrough', hint: 'row.clickThroughHint' }
    ]

    const SAY_LINES = ['我在这儿～', '要不要摸摸？', '干活吧，我盯着你', '歇一会儿眼睛吧', '这个需求有点意思']

    const STYLES = `
.dp-page { display: flex; flex-direction: column; gap: 18px; padding: 4px 2px 28px; }
.dp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dp-title { font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1a1a); margin: 0 0 4px; }
.dp-sub { font-size: 13px; color: var(--dsw-alias-label-secondary, #666); margin: 0; }
.dp-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 5px 10px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1)); color: var(--dsw-alias-label-secondary, #666); white-space: nowrap; }
.dp-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-label-tertiary, #aaa); }
.dp-dot.is-on { background: var(--dsw-alias-brand-primary, #2f7cf6); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #2f7cf6) 22%, transparent); }
.dp-card { border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1)); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, #fff); overflow: hidden; }
.dp-card-head { padding: 14px 16px 10px; }
.dp-card-title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1a1a); margin: 0 0 4px; }
.dp-card-desc { font-size: 12.5px; color: var(--dsw-alias-label-secondary, #666); margin: 0; line-height: 1.5; }
.dp-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 11px 16px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.07)); min-height: 30px; }
.dp-row-label { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dp-row-name { font-size: 13.5px; color: var(--dsw-alias-label-primary, #1a1a1a); }
.dp-row-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary, #8a8a8a); line-height: 1.45; }
.dp-switch { position: relative; flex: none; width: 38px; height: 22px; border-radius: 999px; border: none; cursor: pointer;
  background: var(--dsw-alias-border-l2, rgba(0,0,0,.18)); transition: background .18s ease; padding: 0; }
.dp-switch.is-on { background: var(--dsw-alias-brand-primary, #2f7cf6); }
.dp-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: transform .18s ease; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
.dp-switch.is-on::after { transform: translateX(16px); }
.dp-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #2f7cf6); outline-offset: 2px; }
.dp-chars { display: flex; gap: 10px; padding: 4px 16px 16px; flex-wrap: wrap; }
.dp-char { flex: 1 1 0; min-width: 110px; display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 12px 8px; border-radius: 10px; cursor: pointer; font-size: 12.5px; line-height: 1.3; text-align: center;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); background: transparent;
  color: var(--dsw-alias-label-secondary, #666); transition: border-color .15s ease, background .15s ease; }
.dp-char:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04)); }
.dp-char.is-active { border-color: var(--dsw-alias-brand-primary, #2f7cf6); color: var(--dsw-alias-label-primary, #1a1a1a);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #2f7cf6) 8%, transparent); }
.dp-char-emoji { font-size: 22px; line-height: 1; }
.dp-range { width: 180px; accent-color: var(--dsw-alias-brand-primary, #2f7cf6); }
.dp-range-value { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--dsw-alias-label-tertiary, #8a8a8a); margin-left: 8px; }
.dp-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 16px 16px; }
.dp-btn { font: inherit; font-size: 12.5px; padding: 7px 14px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14)); background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.03));
  color: var(--dsw-alias-label-primary, #1a1a1a); transition: background .15s ease; }
.dp-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
.dp-btn:disabled { opacity: .55; cursor: default; }
.dp-btn.is-primary { background: var(--dsw-alias-brand-primary, #2f7cf6); border-color: transparent; color: #fff; }
.dp-note { font-size: 12px; color: var(--dsw-alias-label-tertiary, #8a8a8a); }
.dp-warn { font-size: 13px; line-height: 1.6; padding: 12px 14px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14)); color: var(--dsw-alias-label-secondary, #666);
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.03)); }
.dp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; padding: 0 16px 16px; }
.dp-stat { border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); border-radius: 10px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 4px; }
.dp-stat-k { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #8a8a8a); }
.dp-stat-v { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1a1a);
  font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

    /** 解析桥接地址：优先 Host 注入，其次上次缓存。 */
    function readBridge() {
      try {
        const injected = window.__DSH_DESKTOP_PET__
        if (injected && injected.port && injected.token) {
          const value = { base: injected.base || `http://127.0.0.1:${injected.port}`, token: injected.token }
          try {
            window.localStorage.setItem(CACHE_KEY, JSON.stringify(value))
          } catch (error) {
            /* 隐私模式下写不了缓存，无所谓 */
          }
          return value
        }
      } catch (error) {
        /* 注入脚本没跑到 */
      }
      try {
        const raw = window.localStorage.getItem(CACHE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && parsed.base && parsed.token) return parsed
        }
      } catch (error) {
        /* 缓存坏了 */
      }
      return null
    }

    function createComponent({ t }) {
      function Switch({ checked, onChange, label }) {
        return h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          className: `dp-switch ${checked ? 'is-on' : ''}`,
          onClick: () => onChange(!checked)
        })
      }

      return function DesktopPetSection() {
        const [state, setState] = React.useState(null)
        const [error, setError] = React.useState('')
        const [notice, setNotice] = React.useState('')
        const bridgeRef = React.useRef(typeof readBridge === 'function' ? readBridge() : null)
        const bridge = bridgeRef.current

        const call = React.useCallback(
          async (path, options) => {
            if (!bridge) throw new Error('no-bridge')
            const url = `${bridge.base}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(bridge.token)}`
            const response = await fetch(url, {
              method: (options && options.method) || 'GET',
              headers: { 'content-type': 'application/json' },
              body: options && options.body ? JSON.stringify(options.body) : undefined
            })
            if (!response.ok) throw new Error(`http ${response.status}`)
            return response.json()
          },
          [bridge]
        )

        const refresh = React.useCallback(async () => {
          if (!bridge) return
          try {
            const payload = await call('/api/state')
            if (payload && payload.state) {
              setState(payload.state)
              setError('')
            }
          } catch (failure) {
            setError('bridge.down')
          }
        }, [bridge, call])

        React.useEffect(() => {
          if (!bridge) return undefined
          let alive = true
          void refresh()
          const timer = window.setInterval(() => {
            if (alive) void refresh()
          }, POLL_MS)
          return () => {
            alive = false
            window.clearInterval(timer)
          }
        }, [bridge, refresh])

        const patch = React.useCallback(
          async (next) => {
            if (!bridge) return
            try {
              const payload = await call('/api/settings', { method: 'POST', body: { patch: next } })
              if (payload && payload.state) {
                setState(payload.state)
                setError('')
                setNotice('state.saved')
                window.setTimeout(() => setNotice(''), 1600)
              }
            } catch (failure) {
              setNotice('state.failed')
              window.setTimeout(() => setNotice(''), 2000)
            }
          },
          [bridge, call]
        )

        const command = React.useCallback(
          async (kind) => {
            try {
              await call('/api/pet/command', { method: 'POST', body: { kind } })
              await refresh()
            } catch (failure) {
              setNotice('state.failed')
              window.setTimeout(() => setNotice(''), 2000)
            }
          },
          [call, refresh]
        )

        const say = React.useCallback(async () => {
          const text = SAY_LINES[Math.floor(Math.random() * SAY_LINES.length)]
          try {
            await call('/api/say', { method: 'POST', body: { text } })
          } catch (failure) {
            setNotice('state.failed')
            window.setTimeout(() => setNotice(''), 2000)
          }
        }, [call])

        if (!bridge) {
          return h(
            'div',
            { className: 'dp-page' },
            h('div', { className: 'dp-head' }, h('h2', { className: 'dp-title' }, t('page.title'))),
            h('div', { className: 'dp-warn' }, t('bridge.missing'))
          )
        }

        const settings = (state && state.settings) || {}
        const pet = (state && state.pet) || {}
        const session = (state && state.session) || {}
        const online = Boolean(pet && pet.connected)

        return h(
          'div',
          { className: 'dp-page' },
          h(
            'div',
            { className: 'dp-head' },
            h(
              'div',
              null,
              h('h2', { className: 'dp-title' }, t('page.title')),
              h('p', { className: 'dp-sub' }, t('page.subtitle'))
            ),
            h(
              'span',
              { className: 'dp-badge', title: error ? t(error) : '' },
              h('span', { className: `dp-dot ${online ? 'is-on' : ''}` }),
              t(online ? 'status.online' : error ? 'bridge.down' : 'status.offline'),
              notice ? ` · ${t(notice)}` : ''
            )
          ),

          error
            ? h('div', { className: 'dp-warn' }, t(error))
            : null,

          // 角色 + 大小
          h(
            'section',
            { className: 'dp-card' },
            h(
              'div',
              { className: 'dp-card-head' },
              h('h3', { className: 'dp-card-title' }, t('row.character')),
              h('p', { className: 'dp-card-desc' }, t('pet.hint'))
            ),
            h(
              'div',
              { className: 'dp-chars' },
              CHARACTERS.map((item) =>
                h(
                  'button',
                  {
                    key: item.id,
                    type: 'button',
                    className: `dp-char ${settings.character === item.id ? 'is-active' : ''}`,
                    'aria-pressed': settings.character === item.id,
                    onClick: () => void patch({ character: item.id })
                  },
                  h('span', { className: 'dp-char-emoji' }, item.emoji),
                  h('span', null, t(`char.${item.id}`))
                )
              )
            ),
            h(
              'div',
              { className: 'dp-row' },
              h('div', { className: 'dp-row-label' }, h('span', { className: 'dp-row-name' }, t('row.scale'))),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center' } },
                h('input', {
                  className: 'dp-range',
                  type: 'range',
                  min: 0.6,
                  max: 1.8,
                  step: 0.05,
                  value: Number(settings.scale) || 1,
                  'aria-label': t('row.scale'),
                  onChange: (event) => void patch({ scale: Number(event.target.value) })
                }),
                h('span', { className: 'dp-range-value' }, `${Math.round((Number(settings.scale) || 1) * 100)}%`)
              )
            )
          ),

          // 行动模式（照原版大肥鱼：散步 / 跟鼠标 / 原地）
          h(
            'section',
            { className: 'dp-card' },
            h(
              'div',
              { className: 'dp-card-head' },
              h('h3', { className: 'dp-card-title' }, t('row.motionTitle')),
              h('p', { className: 'dp-card-desc' }, t('motion.hint'))
            ),
            h(
              'div',
              { className: 'dp-chars' },
              ['wander', 'follow', 'still'].map((mode) =>
                h(
                  'button',
                  {
                    key: mode,
                    type: 'button',
                    className: `dp-char ${settings.motionMode === mode ? 'is-active' : ''}`,
                    'aria-pressed': settings.motionMode === mode,
                    onClick: () => void patch({ motionMode: mode })
                  },
                  h('span', { className: 'dp-char-emoji' }, mode === 'wander' ? '🚶' : mode === 'follow' ? '🖱️' : '🧘'),
                  h('span', null, t(`motion.${mode}`))
                )
              )
            )
          ),

          // 联动
          h(
            'section',
            { className: 'dp-card' },
            h(
              'div',
              { className: 'dp-card-head' },
              h('h3', { className: 'dp-card-title' }, t('row.behaviourTitle'))
            ),
            BOOLEAN_ROWS.map((row) =>
              h(
                'div',
                { className: 'dp-row', key: row.key },
                h(
                  'div',
                  { className: 'dp-row-label' },
                  h('span', { className: 'dp-row-name' }, t(`row.${row.key}`)),
                  row.hint ? h('span', { className: 'dp-row-hint' }, t(row.hint)) : null
                ),
                h(Switch, {
                  checked: Boolean(settings[row.key]),
                  label: t(`row.${row.key}`),
                  onChange: (value) => void patch({ [row.key]: value })
                })
              )
            )
          ),

          // 状态
          h(
            'section',
            { className: 'dp-card' },
            h(
              'div',
              { className: 'dp-card-head' },
              h('h3', { className: 'dp-card-title' }, t('pet.title'))
            ),
            h(
              'div',
              { className: 'dp-grid' },
              h(
                'div',
                { className: 'dp-stat' },
                h('span', { className: 'dp-stat-k' }, t('state.session')),
                h('span', { className: 'dp-stat-v' }, session.title || t('state.noSession'))
              ),
              h(
                'div',
                { className: 'dp-stat' },
                h('span', { className: 'dp-stat-k' }, t('state.tokens')),
                h('span', { className: 'dp-stat-v' }, session.usageLabel || '0')
              ),
              h(
                'div',
                { className: 'dp-stat' },
                h('span', { className: 'dp-stat-k' }, t('state.petPid')),
                h('span', { className: 'dp-stat-v' }, pet.pid ? String(pet.pid) : '—')
              )
            ),
            h(
              'div',
              { className: 'dp-actions' },
              h(
                'button',
                { type: 'button', className: 'dp-btn is-primary', onClick: () => void command('show') },
                t('action.show')
              ),
              h(
                'button',
                { type: 'button', className: 'dp-btn', onClick: () => void command('hide') },
                t('action.hide')
              ),
              h(
                'button',
                { type: 'button', className: 'dp-btn', onClick: () => void command('reset-position') },
                t('action.reset')
              ),
              h('button', { type: 'button', className: 'dp-btn', onClick: () => void say() }, t('action.say')),
              h('span', { className: 'dp-note' }, error ? t(error) : '')
            ),
            h(
              'div',
              { className: 'dp-row' },
              h(
                'div',
                { className: 'dp-row-label' },
                h('span', { className: 'dp-row-name' }, t('preview.title')),
                h('span', { className: 'dp-row-hint' }, t('preview.hint'))
              ),
              h(
                'div',
                { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
                ['done', 'work', 'error', 'sleep'].map((kind) =>
                  h(
                    'button',
                    { key: kind, type: 'button', className: 'dp-btn', onClick: () => void command(kind) },
                    t(`preview.${kind}`)
                  )
                )
              )
            )
          )
        )
      }
    }

    /**
     * @param {import('cordis').Context} ctx
     */
    function apply(ctx) {
      const slots = ctx.get ? ctx.get('slots') : ctx.slots
      const locale = ctx.get ? ctx.get('locale') : ctx.locale
      if (!slots) {
        console.warn('[desktop-pet] 找不到 slots 服务，设置页无法注册')
        return
      }

      let t = (key) => key
      if (locale) {
        ctx.effect(() => locale.register(NS, { zh: ZH, en: EN }), 'desktop-pet: dictionaries')
        const bound = locale.bind(NS)
        t = typeof bound === 'function' ? bound : (key) => key
      }

      ctx.effect(() => {
        if (typeof document === 'undefined' || !document.head) return undefined
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-desktop-pet'
        tag.textContent = STYLES
        document.head.appendChild(tag)
        return () => tag.remove()
      }, 'desktop-pet: settings styles')

      const Section = createComponent({ t })
      slots.inject('settings.section', () =>
        slots.register(
          {
            name: 'settings.section',
            id: 'desktop-pet',
            order: 33,
            label: () => t('nav.title'),
            locale: NS
          },
          Section
        )
      )
    }

    return { inject: ['slots', 'locale'], apply }
  }
})
