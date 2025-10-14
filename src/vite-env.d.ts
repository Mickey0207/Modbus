/// <reference types="vite/client" />

declare global {
  interface Window {
    api: {
      ping: () => string
      sendTcpHex: (host: string, port: number, hex: string) => Promise<{ ok: boolean; data?: string; error?: string }>
    }
  }
}

export {}
