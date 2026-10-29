/**
 * 开发辅助窗口：把 DSH 的 Web 界面装进一个普通 Electron 窗口，方便用 CDP 截图/点按验证插件页面。
 *
 * 用法（由 scripts/gui-shot.mjs 调用，或手动）：
 *   GUI_URL="http://127.0.0.1:3080/?token=..." electron.exe scripts/gui-window --remote-debugging-port=9333
 */
const { app, BrowserWindow } = require('electron')

const url = process.env.GUI_URL || 'http://127.0.0.1:3080'

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    show: true,
    title: 'DSH GUI (capture)',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  win.loadURL(url)
  win.webContents.on('did-finish-load', () => {
    console.log('[gui-capture] loaded', url.replace(/token=[^&]+/, 'token=***'))
  })
})

app.on('window-all-closed', () => app.quit())
