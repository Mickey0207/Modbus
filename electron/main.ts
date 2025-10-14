import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import net from 'node:net'

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
      let chunks: Buffer[] = []
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
      socket.on('data', (buf) => { chunks.push(buf) })
      socket.on('close', () => {
        const data = Buffer.concat(chunks)
        cleanup({ ok: true, data: data.length ? data.toString('hex') : undefined })
      })

      socket.connect(port, host, () => {
        // 將十六進位字串轉為 buffer
        const sanitized = hex.replace(/\s+/g, '')
        const out = Buffer.from(sanitized, 'hex')
        socket.write(out)
        // 部分設備不會主動關閉，這裡在 300ms 後主動結束收取
        setTimeout(() => socket.end(), 300)
      })
    })
  })
})
