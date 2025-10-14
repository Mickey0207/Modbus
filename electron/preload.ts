import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  ping: () => 'pong',
  sendTcpHex: async (host: string, port: number, hex: string) => {
    const res = await ipcRenderer.invoke('net:send', { host, port, hex })
    return res as { ok: boolean; data?: string; error?: string }
  }
})

