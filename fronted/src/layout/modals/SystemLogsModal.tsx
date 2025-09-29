import React, { useMemo, useState, useEffect } from 'react'
import { Modal, SmartTable, Select, Button, LightButton } from '@/components'
import { useMessages, type MsgChannel } from '@/api/contexts/MessagesContext'
import * as SitesApi from '@/api/sites/service'

export default function SystemLogsModal({ open, onClose, channel, title }:{ open: boolean; onClose: () => void; channel: MsgChannel; title: string }) {
  const { messages, clear } = useMessages()
  const [level, setLevel] = useState<'all'|'info'|'success'|'warning'|'error'>('all')
  const [hostNameMap, setHostNameMap] = useState<Record<string, string>>({})
  const [slaveNameMap, setSlaveNameMap] = useState<Record<string, Record<number, string>>>({})
  const [loadingNames, setLoadingNames] = useState(false)

  // 載入一次案場資料以取得顯示名稱（主機/從機）
  const reloadNames = React.useCallback(async () => {
    if (loadingNames) return
    setLoadingNames(true)
    try {
      const sites = await SitesApi.listSites()
      const hmap: Record<string, string> = {}
      const smap: Record<string, Record<number, string>> = {}
      for (const s of (sites || [])) {
        for (const h of (s.hosts || [])) {
          hmap[h.id] = h.name || h.id
          const subs: Record<number, string> = {}
          for (const sl of (h.slaves || [])) {
            const unit = Number((sl as any).unitId)
            if (Number.isFinite(unit)) subs[unit] = sl.name || String(unit)
          }
          smap[h.id] = subs
        }
      }
      setHostNameMap(hmap)
      setSlaveNameMap(smap)
    } catch {
      // ignore
    } finally { setLoadingNames(false) }
  }, [loadingNames])

  // 初次載入與每次打開視窗時都刷新名稱映射，確保顯示最新的主/從機名稱
  useEffect(() => { reloadNames() }, [])
  useEffect(() => { if (open) reloadNames() }, [open, reloadNames])

  const isDbChannel = channel === 'web' || channel === 'dbPollDb'
  const isModbusChannel = channel === 'modbusPoll' || channel === 'modbusSend' || channel === 'dbPollMb'

  const list = useMemo(() => {
    const arr = messages[channel] || []
    if (level === 'all') return arr
    return arr.filter((m) => m.level === level)
  }, [messages, channel, level])

  const columns = useMemo(() => {
    const cols: any[] = [
      { key: 'ts', title: '時間', width: 170, render: (v: number) => new Date(v).toLocaleString() },
      { key: 'level', title: '層級', width: 90 },
      { key: 'hostId', title: '主機', render: (v: string) => hostNameMap[v] || v || '—' },
      { key: 'slaveAddr', title: '從機', render: (v: number, r: any) => {
        if (!Number.isFinite(v)) return '—'
        const sub = slaveNameMap[r.hostId] || {}
        return sub[v] || String(v)
      } },
      { key: 'action', title: '動作', width: 80, render: (v: any) => v === 'write' ? '寫入' : (v === 'read' ? '讀取' : '—') },
      { key: 'ok', title: '結果', width: 80, render: (v: any) => (typeof v === 'boolean' ? (v ? '成功' : '失敗') : '—') },
    ]

    if (isDbChannel) {
      cols.push(
        { key: 'msg', title: '訊息', width: 260, render: (_: any, r: any) => (r?.text || '—') },
        { key: 'db_table', title: '資料表', width: 200, render: (_: any, r: any) => r?.db?.table || '—' },
        { key: 'db_op', title: '類型', width: 100, render: (_: any, r: any) => (r?.db?.op ? String(r.db.op).toUpperCase() : '—') },
        { key: 'db_cols', title: '欄位', render: (_: any, r: any) => {
          const cols = r?.db?.columns
          if (!Array.isArray(cols) || !cols.length) return '—'
          return <span className="mono">{cols.join(', ')}</span>
        } },
        { key: 'db_vals', title: '值', render: (_: any, r: any) => {
          const v = r?.db?.values
          if (v == null) return '—'
          try {
            const text = typeof v === 'string' ? v : JSON.stringify(v)
            return <span className="mono" title={text}>{text.length > 80 ? (text.slice(0, 80) + '…') : text}</span>
          } catch { return <span className="mono">—</span> }
        } },
      )
    }

    if (isModbusChannel) {
      cols.push(
        { key: 'fc', title: '功能', width: 80, render: (_: any, r: any) => {
          const fc = Number(r?.modbus?.fc)
          if (fc === 0x03) return '讀取(03)'
          if (fc === 0x06) return '寫入(06)'
          return fc ? `FC=${fc}` : '—'
        } },
        { key: 'addr', title: '位址', width: 100, render: (_: any, r: any) => {
          const addr = Number(r?.modbus?.address)
          return Number.isFinite(addr) ? addr : '—'
        } },
        { key: 'vals', title: '寫入值', render: (_: any, r: any) => {
          const fc = Number(r?.modbus?.fc)
          const vals = r?.modbus?.values
          if (fc !== 0x06) return '—'
          if (!Array.isArray(vals) || !vals.length) return '—'
          return <span className="mono">[{vals.slice(0,8).join(', ')}{vals.length>8?'…':''}]</span>
        } },
        { key: 'ret', title: '回傳結果', render: (_: any, r: any) => {
          const fc = Number(r?.modbus?.fc)
          const vals = r?.modbus?.values
          if (fc !== 0x03) return '—'
          if (!Array.isArray(vals) || !vals.length) return '—'
          return <span className="mono">[{vals.slice(0,8).join(', ')}{vals.length>8?'…':''}]</span>
        } },
      )
    }

    cols.push({ key: 'light', title: '燈號/調光/訊息', render: (_: any, r: any) => {
      const l = r.light
      if (!l) return r.text ?? ''
      if (l.type === 'SW8') {
        const sw = (l.sw ?? Array(8).fill(false)).slice(0,8)
        return (
          <div className="light-group">
            {sw.map((on:boolean, i:number)=> <LightButton key={i} size="sm" on={!!on} title={`CH${i+1}`} onChange={()=>{}} />)}
          </div>
        )
      }
      if (l.type === 'DIM4') {
        const vals = (l.dimValues ?? [0,0,0,0]).slice(0,4)
        return (
          <div className="row" style={{ gap: 12, alignItems:'center' }}>
            {vals.map((v:number, i:number)=> (
              <div key={i} className="row" style={{ gap: 6, alignItems:'center' }}>
                <LightButton size="sm" on={v > 0} title={`CH${i+1}`} disableToggle onChange={()=>{}} />
                <span className="mono" style={{ minWidth: 48 }}>CH{i+1}:{v}</span>
              </div>
            ))}
          </div>
        )
      }
      return r.text ?? ''
    } })

    return cols
  }, [hostNameMap, slaveNameMap, isDbChannel, isModbusChannel])

  return (
    <Modal isOpen={open} onClose={onClose} title={title} fitContent maxWidth={1800}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <Select
            value={level}
            onChange={(v: string)=>setLevel(v as any)}
            options={[
              { value: 'all', label: '全部' },
              { value: 'info', label: '資訊' },
              { value: 'success', label: '成功' },
              { value: 'warning', label: '警告' },
              { value: 'error', label: '錯誤' },
            ]}
          />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button className="btn--outline" onClick={()=>clear(channel)} disabled={!list.length}>清除</Button>
        </div>
      </div>
      <div className="card" style={{ overflow: 'auto', maxHeight: '72vh', minWidth: 1200 }}>
        <SmartTable className="single-line" columns={columns as any} data={list as any} rowKey={(r:any)=>r.id} showActions={false} />
      </div>
    </Modal>
  )
}
