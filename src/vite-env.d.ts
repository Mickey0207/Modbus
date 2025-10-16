/// <reference types="vite/client" />

declare global {
  interface Window {
    api: {
      ping: () => string
  sendTcpHex: (host: string, port: number, hex: string) => Promise<{ ok: boolean; data?: string; error?: string; chunks?: string[] }>
  sendTcpHexRaw: (host: string, port: number, hex: string, idleMs?: number, overallTimeoutMs?: number) => Promise<{ ok: boolean; data?: string; error?: string; chunks?: string[] }>
      connectHost: (host: string, port: number) => Promise<{ ok: boolean; error?: string }>
      saveJson: (json: string, defaultPath?: string) => Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }>
      openJson: () => Promise<{ ok: boolean; data?: string; filePath?: string; canceled?: boolean; error?: string }>
      monitorStart: (host: string, port: number) => Promise<{ ok: boolean; error?: string }>
      monitorStop: (host: string, port: number) => Promise<{ ok: boolean; error?: string }>
      onMonitorData: (fn: (e: { host: string; port: number; hex: string; len: number; t: number }) => void) => () => void
      onMonitorStatus: (fn: (e: { host: string; port: number; status: 'open'|'close'|'error'; message?: string; t: number }) => void) => () => void
      monitorWrite: (host: string, port: number, hex: string) => Promise<{ ok: boolean; error?: string }>
      onMonitorTx: (fn: (e: { host: string; port: number; hex: string; len: number; t: number }) => void) => () => void
      // Serial (USB-485)
      serialList: () => Promise<{ ok: boolean; ports?: Array<{ path: string; friendlyName?: string; manufacturer?: string }>; error?: string }>
      serialOpen: (path: string, baudRate: number) => Promise<{ ok: boolean; error?: string }>
      serialClose: (path: string) => Promise<{ ok: boolean; error?: string }>
      serialWrite: (path: string, hex: string) => Promise<{ ok: boolean; error?: string }>
  serialSetIdle: (path: string, idleMs: number) => Promise<{ ok: boolean; error?: string }>
      onSerialData: (fn: (e: { path: string; hex: string; len: number; t: number }) => void) => () => void
      onSerialStatus: (fn: (e: { path: string; status: 'open'|'close'|'error'; message?: string; t: number }) => void) => () => void
    }
  }
}

export {}
