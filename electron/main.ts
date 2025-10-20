import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import net from 'node:net'
import { promises as fs } from 'node:fs'
// Lazy require serialport to avoid bundler/ESM interop issues at runtime
let SerialPortLib: any = null
function getSerial() {
  if (!SerialPortLib) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('serialport')
    SerialPortLib = { SerialPort: m.SerialPort }
  }
  return SerialPortLib
}

const isDev = process.env.VITE_DEV_SERVER_URL !== undefined

let mainWindow: BrowserWindow | null = null

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (isDev && devUrl) {
    await mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // IPC: 透過 TCP 傳送 Hex 字串，回傳十六進位回應（若有）
  ipcMain.handle('net:send', async (_evt, payload: { host: string; port: number; hex: string }) => {
    const { host, port, hex } = payload
    return await new Promise((resolve) => {
      const socket = new net.Socket()
      let settled = false
      let acc = Buffer.alloc(0)
      const chunks: string[] = []
      let expectTotal: number | null = null
  // 注意：避免過早結束導致回傳不完整資料，僅使用 socket timeout 作為總逾時控制
  // 不再使用固定的 fallback 計時

      const cleanup = (result: any) => {
        if (settled) return
        settled = true
        try { socket.destroy() } catch {}
        // no extra timers to clear
        resolve(result)
      }

      socket.setTimeout(3000)
      socket.on('timeout', () => cleanup({ ok: false, error: 'timeout' }))
      socket.on('error', (err: any) => {
        const msg = String(err?.message || err)
        const code = (err && (err.code as string)) || ''
        if ((code === 'ECONNRESET' || msg.includes('ECONNRESET')) && acc.length) {
          // 僅在完整幀時視為成功
          if (expectTotal != null && acc.length >= expectTotal) {
            cleanup({ ok: true, data: acc.subarray(0, expectTotal).toString('hex'), chunks })
          } else {
            cleanup({ ok: false, error: 'connection reset before complete frame', data: acc.toString('hex'), chunks })
          }
        } else {
          cleanup({ ok: false, error: msg })
        }
      })
      socket.on('data', (buf) => {
        try { chunks.push(buf.toString('hex')) } catch {}
        acc = Buffer.concat([acc, buf])
        // 一旦有至少 6 bytes（可讀 MBAP.length），就計算應有總長度（6 + length）
        if (expectTotal == null && acc.length >= 6) {
          const lenHi = acc[4]
          const lenLo = acc[5]
          const lengthField = (lenHi << 8) | lenLo // = UnitId(1) + PDU(bytes)
          expectTotal = 6 + lengthField
        }
        if (expectTotal != null && acc.length >= expectTotal) {
          // 取到完整一幀 ADU，直接回傳
          const frame = acc.subarray(0, expectTotal)
          cleanup({ ok: true, data: frame.toString('hex'), chunks })
        }
      })
      socket.on('close', () => {
        // 若在未決狀態下被關閉，僅在完整幀時回傳成功，否則視為失敗
        if (!settled) {
          if (expectTotal != null && acc.length >= expectTotal) {
            const frame = acc.subarray(0, expectTotal)
            cleanup({ ok: true, data: frame.toString('hex'), chunks })
          } else {
            cleanup({ ok: false, error: 'socket closed before complete frame', data: acc.length ? acc.toString('hex') : undefined, chunks })
          }
        }
      })

      socket.connect(port, host, () => {
        try { socket.setNoDelay(true) } catch {}
        try { socket.setKeepAlive(true, 10_000) } catch {}
        const sanitized = hex.replace(/\s+/g, '')
        const out = Buffer.from(sanitized, 'hex')
        socket.write(out)
        // 僅依據 MBAP 長度與 socket timeout 來決定結束，不做固定 fallback
      })
    })
  })

  // IPC: 透明轉發 Raw（不以 MBAP 判斷長度），以「閒置時間」做封包結束
  ipcMain.handle('net:send-raw', async (_evt, payload: { host: string; port: number; hex: string; idleMs?: number; overallTimeoutMs?: number }) => {
    const { host, port, hex, idleMs = 600, overallTimeoutMs = 5000 } = payload || ({} as any)
    return await new Promise((resolve) => {
      const socket = new net.Socket()
      let settled = false
      let acc = Buffer.alloc(0)
      const chunks: string[] = []
      let idleTimer: NodeJS.Timeout | null = null
      let overallTimer: NodeJS.Timeout | null = null

      const cleanup = (result: any) => {
        if (settled) return
        settled = true
        try { socket.destroy() } catch {}
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
        if (overallTimer) { clearTimeout(overallTimer); overallTimer = null }
        resolve(result)
      }

      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => cleanup({ ok: true, data: acc.length ? acc.toString('hex') : undefined, chunks }), idleMs)
      }

      socket.setTimeout(overallTimeoutMs)
      socket.on('timeout', () => cleanup({ ok: true, data: acc.length ? acc.toString('hex') : undefined, chunks }))
      socket.on('error', (err: any) => cleanup({ ok: false, error: String(err?.message || err) }))
      socket.on('data', (buf) => { try { chunks.push(buf.toString('hex')) } catch {}; acc = Buffer.concat([acc, buf]); armIdle() })
      socket.on('close', () => { if (!settled) cleanup({ ok: true, data: acc.length ? acc.toString('hex') : undefined, chunks }) })

      socket.connect(port, host, () => {
        try { socket.setNoDelay(true) } catch {}
        try { socket.setKeepAlive(true, 10_000) } catch {}
        const sanitized = (hex || '').replace(/\s+/g, '')
        const out = Buffer.from(sanitized, 'hex')
        socket.write(out)
        // 啟動 overall 計時，避免長時間無結束
        overallTimer = setTimeout(() => cleanup({ ok: true, data: acc.length ? acc.toString('hex') : undefined, chunks }), overallTimeoutMs)
        // 注意：idle 計時僅在收到第一個資料後才會啟動（於 'data' 事件內），避免回覆較慢時過早結束
      })
    })
  })

  // IPC: 測試 TCP 連線是否可建立（不傳資料），立即關閉
  ipcMain.handle('net:connect', async (_evt, payload: { host: string; port: number }) => {
    const { host, port } = payload
    return await new Promise((resolve) => {
      const socket = new net.Socket()
      let settled = false

      const cleanup = (result: any) => {
        if (settled) return
        settled = true
        try { socket.destroy() } catch {}
        resolve(result)
      }

      socket.setTimeout(3000)
      socket.on('timeout', () => cleanup({ ok: false, error: 'timeout' }))
      socket.on('error', (err) => cleanup({ ok: false, error: String(err?.message || err) }))
      socket.on('connect', () => {
        cleanup({ ok: true })
      })

      socket.connect(port, host)
    })
  })

  // IPC: 檔案另存為 JSON（純手動匯出）
  ipcMain.handle('file:save-json', async (_evt, payload: { json: string; defaultPath?: string }) => {
    try {
      const { json, defaultPath } = payload || {}
      const res = await dialog.showSaveDialog({
        title: '匯出 JSON',
        defaultPath: defaultPath || 'modbus-snapshot.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      await fs.writeFile(res.filePath, json ?? '', 'utf-8')
      return { ok: true, filePath: res.filePath }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
  })

  // IPC: 開啟 JSON（純手動匯入）
  ipcMain.handle('file:open-json', async () => {
    try {
      const res = await dialog.showOpenDialog({
        title: '匯入 JSON',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true }
      const filePath = res.filePaths[0]
      const data = await fs.readFile(filePath, 'utf-8')
      return { ok: true, data, filePath }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
  })

  // ============ Persistent Monitor (Raw TCP tap) ============
  type MonKey = string
  const monitors = new Map<MonKey, net.Socket>()
  const keyOf = (senderId: number, host: string, port: number) => `${senderId}:${host}:${port}`

  ipcMain.handle('net:monitor-start', async (evt, payload: { host: string; port: number }) => {
    try {
      const { host, port } = payload || ({} as any)
      const key = keyOf(evt.sender.id, host, port)
      if (monitors.has(key)) {
        // Already running
        return { ok: true }
      }
      const socket = new net.Socket()
      monitors.set(key, socket)
      const sendStatus = (status: 'open'|'close'|'error', msg?: string) => {
        try { evt.sender.send('net:monitor-status', { host, port, status, message: msg, t: Date.now() }) } catch {}
      }
      const sendData = (buf: Buffer) => {
        try { evt.sender.send('net:monitor-data', { host, port, hex: buf.toString('hex'), len: buf.length, t: Date.now() }) } catch {}
      }
      socket.setKeepAlive(true, 10_000)
      socket.setNoDelay(true)
      socket.on('connect', () => sendStatus('open'))
      socket.on('data', (buf) => sendData(buf))
      socket.on('error', (err) => { sendStatus('error', String(err?.message || err)); try { socket.destroy() } catch {} })
      socket.on('close', () => { sendStatus('close'); monitors.delete(key) })
      socket.connect(port, host)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
  })

  ipcMain.handle('net:monitor-stop', async (evt, payload: { host: string; port: number }) => {
    try {
      const { host, port } = payload || ({} as any)
      const key = keyOf(evt.sender.id, host, port)
      const sock = monitors.get(key)
      if (sock) { try { sock.destroy() } catch {}; monitors.delete(key) }
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
  })

  ipcMain.handle('net:monitor-write', async (evt, payload: { host: string; port: number; hex: string }) => {
    try {
      const { host, port, hex } = payload || ({} as any)
      const key = keyOf(evt.sender.id, host, port)
      const sock = monitors.get(key)
      if (!sock) return { ok: false, error: 'monitor not running' }
      const sanitized = (hex || '').replace(/\s+/g, '')
      const out = Buffer.from(sanitized, 'hex')
      sock.write(out)
      try { evt.sender.send('net:monitor-tx', { host, port, hex: out.toString('hex'), len: out.length, t: Date.now() }) } catch {}
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
  })

  // ============ Serial (USB-485) ============
  type SerKey = string
  const serials = new Map<SerKey, any>()
  const serialBuffers = new Map<SerKey, Buffer>()
  const serialTimers = new Map<SerKey, NodeJS.Timeout>()
  const serialIdleCfg = new Map<SerKey, number>()
  const SERIAL_IDLE_MS_DEFAULT = 80 // flush a frame after ~80ms of silence
  const serKeyOf = (senderId: number, path: string) => `${senderId}:${path}`

  ipcMain.handle('serial:list', async () => {
    try {
  const { SerialPort } = getSerial()
  const ports = await SerialPort.list()
      return { ok: true, ports: ports.map(p=>({ path:p.path, friendlyName:(p as any).friendlyName, manufacturer:p.manufacturer })) }
    } catch (e:any) { return { ok:false, error:String(e?.message||e) } }
  })

  ipcMain.handle('serial:open', async (evt, payload: { path: string; baudRate: number; idleMs?: number }) => {
    try {
      const { path, baudRate, idleMs } = payload || ({} as any)
      const key = serKeyOf(evt.sender.id, path)
      if (serials.has(key)) return { ok: true }
  const { SerialPort } = getSerial()
  const port = new SerialPort({ path, baudRate, autoOpen: false })
      serials.set(key, port)
      serialBuffers.set(key, Buffer.alloc(0))
      serialIdleCfg.set(key, typeof idleMs === 'number' && idleMs >= 5 ? idleMs : SERIAL_IDLE_MS_DEFAULT)
      const sendStatus = (status:'open'|'close'|'error', message?:string) => { try{ evt.sender.send('serial:status',{ path, status, message, t:Date.now() }) }catch{} }
      const flushFrame = () => {
        const acc = serialBuffers.get(key) || Buffer.alloc(0)
        if (acc.length) {
          try { evt.sender.send('serial:data', { path, hex: acc.toString('hex'), len: acc.length, t: Date.now() }) } catch {}
          serialBuffers.set(key, Buffer.alloc(0))
        }
      }
      const armIdle = () => {
        const old = serialTimers.get(key)
        if (old) clearTimeout(old)
        const ms = serialIdleCfg.get(key) ?? SERIAL_IDLE_MS_DEFAULT
        const h = setTimeout(() => { flushFrame() }, ms)
        serialTimers.set(key, h)
      }
      port.on('open', ()=> sendStatus('open'))
      port.on('data', (buf)=> {
        const cur = serialBuffers.get(key) || Buffer.alloc(0)
        serialBuffers.set(key, Buffer.concat([cur, buf]))
        armIdle()
      })
      port.on('error', (err)=> { sendStatus('error', String(err?.message||err)); try{ port.close() }catch{} })
      port.on('close', ()=> { try { flushFrame() } catch {}; sendStatus('close'); serials.delete(key); const t=serialTimers.get(key); if(t) clearTimeout(t); serialTimers.delete(key); serialBuffers.delete(key); serialIdleCfg.delete(key) })
      await new Promise<void>((resolve, reject)=> port.open((err)=> err? reject(err): resolve()))
      return { ok: true }
    } catch (e:any) { return { ok:false, error:String(e?.message||e) } }
  })

  ipcMain.handle('serial:close', async (evt, payload:{ path:string }) => {
    try {
      const { path } = payload || ({} as any)
      const key = serKeyOf(evt.sender.id, path)
      const p = serials.get(key)
      if (p) { await new Promise<void>((resolve)=> p.close(()=> resolve())); serials.delete(key) }
      const t = serialTimers.get(key); if (t) clearTimeout(t); serialTimers.delete(key)
      serialBuffers.delete(key); serialIdleCfg.delete(key)
      return { ok: true }
    } catch (e:any) { return { ok:false, error:String(e?.message||e) } }
  })

  ipcMain.handle('serial:set-idle', async (evt, payload:{ path:string; idleMs:number }) => {
    try{
      const { path, idleMs } = payload || ({} as any)
      const key = serKeyOf(evt.sender.id, path)
      if (!serials.has(key)) return { ok:false, error:'serial not open' }
      serialIdleCfg.set(key, typeof idleMs === 'number' && idleMs >= 5 ? idleMs : SERIAL_IDLE_MS_DEFAULT)
      return { ok:true }
    }catch(e:any){ return { ok:false, error:String(e?.message||e) } }
  })

  ipcMain.handle('serial:write', async (evt, payload:{ path:string; hex:string }) => {
    try {
      const { path, hex } = payload || ({} as any)
      const key = serKeyOf(evt.sender.id, path)
      const p = serials.get(key)
      if (!p) return { ok:false, error:'serial not open' }
      const out = Buffer.from((hex||'').replace(/\s+/g,'') , 'hex')
      await new Promise<void>((resolve, reject)=> p.write(out, (err)=> err? reject(err): resolve()))
      return { ok: true }
    } catch (e:any) { return { ok:false, error:String(e?.message||e) } }
  })
})
