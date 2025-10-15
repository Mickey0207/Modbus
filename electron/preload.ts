import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  ping: () => 'pong',
  sendTcpHex: async (host: string, port: number, hex: string) => {
    const res = await ipcRenderer.invoke('net:send', { host, port, hex })
    return res as { ok: boolean; data?: string; error?: string; chunks?: string[] }
  },
  sendTcpHexRaw: async (host: string, port: number, hex: string, idleMs?: number, overallTimeoutMs?: number) => {
    const res = await ipcRenderer.invoke('net:send-raw', { host, port, hex, idleMs, overallTimeoutMs })
    return res as { ok: boolean; data?: string; error?: string; chunks?: string[] }
  },
  connectHost: async (host: string, port: number) => {
    const res = await ipcRenderer.invoke('net:connect', { host, port })
    return res as { ok: boolean; error?: string }
  },
  saveJson: async (json: string, defaultPath?: string) => {
    const res = await ipcRenderer.invoke('file:save-json', { json, defaultPath })
    return res as { ok: boolean; filePath?: string; canceled?: boolean; error?: string }
  },
  openJson: async () => {
    const res = await ipcRenderer.invoke('file:open-json')
    return res as { ok: boolean; data?: string; filePath?: string; canceled?: boolean; error?: string }
  },
  monitorStart: async (host: string, port: number) => {
    const res = await ipcRenderer.invoke('net:monitor-start', { host, port })
    return res as { ok: boolean; error?: string }
  },
  monitorStop: async (host: string, port: number) => {
    const res = await ipcRenderer.invoke('net:monitor-stop', { host, port })
    return res as { ok: boolean; error?: string }
  },
  onMonitorData: (fn: (e: { host: string; port: number; hex: string; len: number; t: number }) => void) => {
    const h = (_: any, payload: any) => { try { fn(payload) } catch {} }
    ipcRenderer.on('net:monitor-data', h)
    return () => ipcRenderer.removeListener('net:monitor-data', h)
  },
  onMonitorStatus: (fn: (e: { host: string; port: number; status: 'open'|'close'|'error'; message?: string; t: number }) => void) => {
    const h = (_: any, payload: any) => { try { fn(payload) } catch {} }
    ipcRenderer.on('net:monitor-status', h)
    return () => ipcRenderer.removeListener('net:monitor-status', h)
  },
  monitorWrite: async (host: string, port: number, hex: string) => {
    const res = await ipcRenderer.invoke('net:monitor-write', { host, port, hex })
    return res as { ok: boolean; error?: string }
  },
  onMonitorTx: (fn: (e: { host: string; port: number; hex: string; len: number; t: number }) => void) => {
    const h = (_: any, payload: any) => { try { fn(payload) } catch {} }
    ipcRenderer.on('net:monitor-tx', h)
    return () => ipcRenderer.removeListener('net:monitor-tx', h)
  }
})

