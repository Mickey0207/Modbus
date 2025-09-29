import { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type MsgLevel = 'info'|'success'|'warning'|'error'
export type MsgChannel = 'web' | 'modbusPoll' | 'modbusSend' | 'dbPollDb' | 'dbPollMb'

// 可攜帶結構化的 Modbus 內容，支援顯示燈號與調光
export type Msg = {
  id: string
  ts: number
  channel: MsgChannel
  level: MsgLevel
  text?: string
  ok?: boolean
  // 主/從/燈號資訊（可選）
  hostId?: string
  slaveAddr?: number
  action?: 'read' | 'write'
  // 目標型別（可選，用於清楚標明作用對象）
  target?: 'host' | 'slave'
  // Modbus 操作細節（讀/寫的功能碼、位址、長度與數值）
  modbus?: {
    fc: number
    address: number
    quantity?: number
    values?: number[]
  }
  // DB 操作細節（表名、操作、欄位/值摘要）
  db?: {
    table: string
    op: 'insert' | 'update' | 'delete' | 'upsert' | 'replace'
    columns?: string[]
    values?: any
    where?: string
  }
  light?: {
    type: 'SW8' | 'DIM4'
    sw?: boolean[] // 8 路開關狀態
    dimValues?: number[] // 4 路調光值 0..255
  }
}

type PushInput =
  | { channel: MsgChannel; level: MsgLevel; text: string; ok?: boolean }
  | ({ channel: MsgChannel; level: MsgLevel } & Omit<Msg, 'id'|'ts'|'level'|'channel'>)

interface Ctx {
  messages: Record<MsgChannel, Msg[]>
  last: Record<MsgChannel, Msg | undefined>
  push: (input: PushInput) => void
  clear: (channel?: MsgChannel) => void
}

const MessagesContext = createContext<Ctx | null>(null)

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<Record<MsgChannel, Msg[]>>({ web: [], modbusPoll: [], modbusSend: [], dbPollDb: [], dbPollMb: [] })

  const push = useCallback<Ctx['push']>((input) => {
    const { channel, level, ...rest } = input as any
    setMessages(prev => {
      const ch = channel as MsgChannel
      const list = prev[ch] ?? []
      const nextMsg: Msg = { id: (globalThis.crypto as any)?.randomUUID?.() || String(Date.now()), ts: Date.now(), channel: ch, level, ...(rest || {}) }
      return { ...prev, [ch]: [nextMsg, ...list].slice(0, 100) }
    })
  }, [])

  const clear = useCallback<Ctx['clear']>((channel) => {
    setMessages(prev => channel ? { ...prev, [channel]: [] } : { web: [], modbusPoll: [], modbusSend: [], dbPollDb: [], dbPollMb: [] })
  }, [])

  const last = useMemo(() => ({
    web: messages.web[0],
    modbusPoll: messages.modbusPoll[0],
    modbusSend: messages.modbusSend[0],
    dbPollDb: messages.dbPollDb[0],
    dbPollMb: messages.dbPollMb[0],
  }), [messages])

  const value = useMemo(() => ({ messages, last, push, clear }), [messages, last, push, clear])
  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>
}

export function useMessages() {
  const ctx = useContext(MessagesContext)
  if (!ctx) throw new Error('useMessages must be used within MessagesProvider')
  return ctx
}
