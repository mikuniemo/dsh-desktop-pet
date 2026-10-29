# 维护手册（dsh-desktop-pet）

> 本文档面向后续维护（含新开 AI 会话时直接贴给模型当上下文）。
> 记录：架构决策、协议契约、设置所有权、踩过的坑、加功能的标准做法、验证手段。
> 最后更新：2026-10-29，对应提交 `c5aa249`。

## 0. 30 秒速览

- 这是**两件套**：`plugin/`（DSH Cordis 插件，装进 DSH profile）+ `pet/`（独立 Electron 桌宠程序）。
- 插件是"大脑"：监听 DSH 会话事件 → 翻译成动作 → 通过本机 HTTP+SSE 推给桌宠；顺便托管桌宠进程、拥有设置文件。
- 桌宠是"身体"：透明置顶窗口、三视图形象、散步行为、托盘、投喂。**它自己不认识 DSH**，只认桥接协议。
- 设置正本一份：`%APPDATA%\dsh-desktop-pet\settings.json`，由**插件 Host 拥有并落盘**；桌宠启动时读快照、本地改动回写、Host 重启后合并（见 §4）。

## 1. 目录与文件职责

```
dsh-desktop-pet/
├─ plugin/                     ← DSH bundle（npm 包名 dsh-desktop-pet）
│  ├─ package.json             dsh.bundle.patch + dsh.client 声明（Client 半入口）
│  ├─ cordis.patch.yml         挂载行：id: desktop-pet（别改 id，是设置命名空间）
│  ├─ index.js                 Host 半：桥接、事件翻译、余额/花费播报、进程托管、gui.url 下发
│  ├─ client.js                Client 半：设置→桌宠页（纯 JS + window.__ModuleLoader__，无构建）
│  ├─ lib/
│  │  ├─ bridge.js             本机 HTTP+SSE 服务（127.0.0.1 + token；/health /stream /pet/* /api/*）
│  │  ├─ store.js              settings.json 读写（normalizeSettings 白名单校验；加设置项改这里）
│  │  ├─ watcher.js            session/event → 动作/会话状态（token 累计、turn 计数）
│  │  ├─ actions.js            工具名→语义动作映射表 + 台词（加动作先改这张表）
│  │  └─ pet-process.js        找/拉起桌宠（petExecutable > pet/dist/*.exe > pet/+electron 开发模式）
│  ├─ locale/{zh,en}.json      插件市场卡片文案（meta.title/description）
│  └─ icon.png / icon.svg
├─ pet/                        ← Electron 桌宠（electron-vite + React，无热更构建链，改完要 build）
│  ├─ src/main/
│  │  ├─ index.ts              窗口/托盘/投喂/IPC/设置应用（applySettings persist 机制在这）
│  │  ├─ bridge.ts             SSE 客户端（断线 1s→10s 退避重连；读 bridge.json）
│  │  ├─ motion.ts             ★ 行为引擎：散步/跟随鼠标/小动作（参数照抄原版大肥鱼）
│  │  ├─ gui-window.ts         DSH 界面独立窗口（聚焦/记忆位置/新 token 自动重载）
│  │  └─ store.ts              window.json + settings.json 启动快照
│  ├─ src/renderer/src/pet/
│  │  ├─ App.tsx               演出状态机：ACTION_LOOK 表（语义动作→视图/道具/时长）
│  │  ├─ extra.css             表演层动画（think/work/walk/accent-*/token 角标）
│  │  ├─ pet.css               基础布局（窗口 300×430 逻辑 px，气泡定位）
│  │  └─ characters/
│  │     ├─ WhaleGirl.tsx      鲸鱼娘三视图（front/side/back PNG + CSS 动效）
│  │     └─ Cat/Ghost/Slime.tsx 备用 SVG 角色
│  ├─ src/shared/types.ts      两侧共享类型（PetSettings/PetAct/WalkState…与 plugin/lib/store.js 同步）
│  ├─ src/renderer/public/sprites/  三视图 PNG（逐帧精灵方案已回退且素材因授权不明移除）
│  ├─ src/renderer/public/sounds/   音效（oops/ding/ask 由 scripts/make-sounds.mjs 生成）
│  ├─ resources/focus-gui.ps1  浏览器里聚焦已开 DSH 标签（标题粗筛+地址栏URL校验+回滚）
│  └─ scripts/make-sounds.mjs  自制柔和提示音生成器
├─ scripts/                    调试工具（见 §7）
└─ docs/shots/                 README 截图
```

## 2. 桥接协议（改任何一侧都必须对表）

发现机制：插件启动后写 `%APPDATA%\dsh-desktop-pet\bridge.json` = `{ port, token, pid, startedAt }`。
桌宠经环境变量 `DSH_DESKTOP_PET_*` 或该文件找到桥。**token 每次 DSH 启动都换**，别缓存。

### Host → 桌宠（SSE `/stream`，`data: {type, ...}`）

| type | 载荷 | 含义 |
| --- | --- | --- |
| `hello` | `{state}` | 新连接，state=完整状态快照（含 gui.url 带 token） |
| `act` | `{act:{kind,action,text,tone,prop}}` | 一次演出。action ∈ actions.js 的 ACTIONS；kind 如 tool-start/turn-end/balance-low |
| `session` | `{session}` | 会话状态（title/turn/running/usage.totalLabel） |
| `settings` | `{settings}` | Host 侧设置变更广播（桌宠应用但**不回写**） |
| `balance` | `{balance}` | 余额/花费（deepseekAccount 可用时） |
| `command` | `{kind}` | 遥控：show/hide/reset-position/quit/reload/pat/wave/error/sleep/eat/think/work/done/open-gui |

### 桌宠 → Host（HTTP POST，query `?token=`）

| 路径 | 体 | Host 处理 |
| --- | --- | --- |
| `/pet/hello` | `{pid,version,character,scale,settings}` | 记录 + **合并 settings 落盘**（桥断开期间的用户改动靠它保命） |
| `/pet/prefs` | `{position?,character?,scale?,settings?}` | 同上 + 位置回报；`settings` 来自托盘 persist 路径 |
| `/pet/event` | `{kind,...}` | 仅日志 |
| `/api/state` `/api/settings` `/api/pet/command` `/api/say` | — | 设置页用 |

`/health` 无需 token（探针）。

## 3. 事件翻译链（DSH → 桌宠）

```
session/event(根作用域)  ─
agent/status / agent/error ─┤→ plugin/lib/watcher.js → onAct/onState
                            │      │
                            │      ├─ actions.js: actForTool(工具名)→{action,text}
                            │      ├─ turn/end → reportTurn(index.js) 拼 token+花费
                            │      └─ bridge.broadcast({type:'act'})
                            └─ usage 累计：assistant/message.usage 逐条相加
```

- 桌宠端 `App.tsx ACTION_LOOK` 把语义 action 映射成 {mode(视图姿态), view(正/侧/背), prop(头顶emoji), hold(ms)}。
- **加一个新动作** = actions.js 加映射 + App.tsx ACTION_LOOK 加配方 + （可选）extra.css 加 `mode-xxx` 动画。
- 去重：watcher 里 DEDUPE_MS=350，同 action+text 连发只留一条。
- 工具演出优先：`pushAct` 会 `markBusy(3600)`，busy 期间 motion.ts 停止散步。

## 4. 设置所有权（本项目最容易出 bug 的地方，血泪史见 §6.4）

规则一句话：**Host 的 settings.json 是唯一正本；谁改谁负责落盘；重启后以文件为准。**

- 设置页（client.js）→ `POST /api/settings` → `store.patch()` 落盘 → 广播 `{type:'settings'}` → 桌宠应用（不回写）。
- 桌宠托盘/本地操作 → `applySettings(raw, {persist:true})` → `POST /pet/prefs {settings:changed}` → Host 合并落盘 → 广播回来（值相同，幂等）。
- Host 推来的应用路径（handleBridgeMessage 的 settings/hello/state）**绝不带 persist**——否则回声循环。
- 桌宠启动：`loadSettingsSnapshot()` 直接读 settings.json，DSH 没起来也按上次设置显示。
- `normalizeSettings`（plugin/lib/store.js）是白名单校验：**加新设置项必须同时改** ① store.js 的 DEFAULT_SETTINGS+SETTING_KINDS ② pet/shared/types.ts 的 PetSettings+DEFAULT_SETTINGS ③ client.js 的 BOOLEAN_ROWS 或对应控件 ④（如需桌宠响应）index.ts 的 applySettings。

## 5. 行为引擎参数（motion.ts，全部照抄原版 1190fasheqi/dafeiyu-pet）

TICK 20ms｜SPEED 380px/s｜惯性系数 0.3/tick｜到达 <12px 后休息 8~18s｜边界=工作区留 40px（按**窗口中心**取点）｜
`|dx|>|dy|×1.15` 用侧视图（左=镜像），否则上=背面/下=正面｜走路 0.2%/tick 蹦｜站立 1%/tick 小动作（35%蹦 25%摇 20%伸 10%说，说话冷却 30s）｜
跟随模式：光标距窗 100px 内停，否则挪到光标左 90px。台词表 LINES/INNER_LINES 在文件顶部。

## 6. 踩过的坑（别踩第二次）

### 6.1 插件代码热更新规则
- 新装/升级 bundle：HMR 直接生效。
- **已 link 的包改 JS（plugin/index.js、lib/*）：必须重启 dsh web**（双击桌面「DSH 重启」）。
- client.js 改动：重启后还需**浏览器/独立窗口刷新**一次才加载新 Client 模块。
- pet/ 改动：`npm run build` + 杀桌宠进程（看门狗 30s 内用新构建拉起）。

### 6.2 Electron 菜单/坐标
- `menu.popup({x,y})` 在 Windows 按**窗口内坐标**解释，传屏幕坐标会跑偏——要么不传（默认光标），要么 `win.getPosition()` 换算。
- 桌宠右键菜单已移除（用户要求），入口统一托盘。

### 6.3 渲染
- 精灵图放大必须**按 devicePixelRatio 取整数倍**，否则发糊（本项目 192×208 源帧 → 2× 物理像素）。
- 气泡别用 `left:50%+translateX(-50%)` 定宽——可用宽度被收缩成半窗；用 `left/right + width:fit-content + margin-inline:auto`。
- 逐帧精灵方案（WhaleSprite + 16ms setInterval）在透明置顶窗口上**实测卡顿**，已回退三视图+CSS；不要走回头路，除非改用 rAF+CSS steps。

### 6.4 设置被覆盖（已修，防回归）
托盘改动不回写 → 重启被 Host 旧值盖掉。修复=§4 的 persist 机制 + hello 带快照。
验证方法：托盘改"静音"→ 杀桌宠 → 看 settings.json 里 `sounds` 是否变了。

### 6.5 PowerShell（focus-gui.ps1 / dsh 启停脚本）
- 脚本必须 **UTF-8 with BOM**（PS 5.1 中文）。
- 给**外部** powershell.exe 传开关不能写 `-Quiet:$Quiet`（会变字符串报错），要拼数组 `@args`。
- 截图/取窗口坐标要先声明 DPI 感知（capture-window.ps1 已处理）。

### 6.6 其他
- `deepseekAccount` 是**可选服务**：只能 `ctx.get('deepseekAccount')`，绝不能进 `inject`（老宿主会卡死插件）。
- 余额花费=两次余额差（0<Δ<100 才采信），不是估价。
- 看门狗：Host 每 30s 检查桥接，桌宠没了自动拉（settings.visible=false 时不拉）。
- 单实例锁：桌宠 `requestSingleInstanceLock`，第二个实例直接退出并把已有窗口叫出来。

## 7. 验证手段（改完照这套走）

```powershell
# 语法/类型
node --check plugin\index.js   # 及 lib/*.js、client.js
npm --prefix pet run typecheck

# 桥活着吗 / 桌宠连上吗
$b = Get-Content "$env:APPDATA\dsh-desktop-pet\bridge.json" -Raw | ConvertFrom-Json
Invoke-RestMethod "http://127.0.0.1:$($b.port)/health"

# 试演动作（不用等真实工具调用）
Invoke-RestMethod -Method POST "http://127.0.0.1:$($b.port)/api/pet/command?token=$($b.token)" `
  -Body '{"kind":"error"}' -ContentType 'application/json'   # error/sleep/eat/think/work/done

# 让桌宠说话（走完整 Host→SSE→渲染链路）
Invoke-RestMethod -Method POST "http://127.0.0.1:$($b.port)/api/say?token=$($b.token)" `
  -Body '{"text":"测试"}' -ContentType 'application/json'

# 看桌宠 DOM 状态（需桌宠带 --remote-debugging-port=9222 启动）
node scripts/inspect-dom.mjs "JSON.stringify({mode: document.querySelector('.pet-anchor')?.className})"

# 截桌宠窗口图（无需置顶，DPI 已处理）
pwsh -File scripts/capture-window.ps1 -Out docs/shots/check.png

# 验证设置页：用 Electron 开 DSH 界面并自动点进 设置→桌宠 截图
node scripts/gui-shot.mjs docs/shots/gui.png
```

## 8. 发布（GitHub）

- 包名 `dsh-desktop-pet`（plugin/package.json），仓库建议同名。
- `.gitignore` 已排除 node_modules/out/dist。素材授权：三视图 PNG 来自 MIT 的
  [1190fasheqi/dafeiyu-pet](https://github.com/1190fasheqi/dafeiyu-pet)，保留 NOTICE.md 署名即可；
  弃用的逐帧精灵图（codex-pet 仓库，无许可证声明）**已从仓库删除**，不要把它提交回来。
- 用户安装：`dsh plugin --profile web add github:<user>/dsh-desktop-pet`（DSH 支持 github: 前缀时装 repo 根；
  本仓库插件在 `plugin/` 子目录，如命令不支持子目录，指导用户 `git clone` 后 `add link:<路径>/plugin`）。
- 版本号三处同步：plugin/package.json、pet/package.json、根 package.json。
- 发版前跑 §7 全表 + 手动过一遍：散步、拖拽、投喂、托盘改设置→重启桌宠→设置保留、DSH 重启→动作恢复。

## 9. 待办 / 已知不足（下个会话可以从这里挑）

- [ ] 多屏 + 跨屏 DPI 时散步目标点只用最近显示器工作区，未处理负坐标副屏边界
- [ ] 花费播报依赖余额轮询（3min），高频小额调用可能察觉不到；可接 sessionTelemetry（需先 inspect 契约）
- [ ] macOS/Linux 未实测（代码路径是跨平台的）
- [ ] 逐帧动画想救回来的话：rAF + CSS steps() + 预切片，别再上 setInterval
- [ ] 角色包机制（外部素材导入）——用户之前勾选过"可换角色包"，当前只有内置四只
