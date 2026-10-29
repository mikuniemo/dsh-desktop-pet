const port = 9222
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.filter((t) => t.type === 'page').find((t) => /^file:/.test(t.url || ''))
if (!page) { console.error('no pet page'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 1
const send = (method, params) => ws.send(JSON.stringify({ id: id++, method, params }))
ws.addEventListener('open', () => {
  send('Runtime.enable')
  send('Log.enable')
  setTimeout(() => {
    // 顺便问一下页面状态
    ws.send(JSON.stringify({ id: 99, method: 'Runtime.evaluate', params: { expression: "JSON.stringify({anchor: !!document.querySelector('.pet-anchor'), art: !!document.querySelector('.whale-art'), petApi: typeof window.petAPI, text: (document.body.innerText||'').slice(0,60)})", returnByValue: true } }))
  }, 800)
  setTimeout(() => ws.close(), 3500)
})
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.consoleAPICalled') {
    console.log('[console]', msg.params.type, msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('[exception]', JSON.stringify(msg.params.exceptionDetails).slice(0, 400))
  } else if (msg.id === 99) {
    console.log('[state]', msg.result?.result?.value)
  }
})
