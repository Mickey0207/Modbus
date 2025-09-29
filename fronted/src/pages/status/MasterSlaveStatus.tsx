import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, SmartTable, LightButton, Select, Input, InlineEditableCell, NumberInput, Modal } from '@/components/index'
import { IconLink, IconTrash } from '@/components/icons'
import useHosts from '@/hooks/useHosts'
import { upsertHost, deleteHost, type HostConfig } from '@/api/hosts/registry'
import { writeOrQueue } from '@/api/modbus/operations'
import { pollStatuses, listSlavesByHost, scanAllSlaves, setSlaveEnabled, setSlaveType } from '@/api/status'
import { sw8MaskAddress, dimMaskAddress, dimValueAddress } from '@/api/modbus/mapping'
import { useMessages } from '@/api/contexts/MessagesContext'

export default function MasterSlaveStatus() {
  const [pollMs, setPollMs] = useState<number>(0)
  const { hosts, loading, error, refresh, connect, disconnect } = useHosts({ pollMs })
  const connectedCount = hosts.filter(h => h.connected).length
  const shownHosts = hosts
  const [scanStamp, setScanStamp] = useState<Record<string, number>>({})
  const [autoPoll, setAutoPoll] = useState(false)
  const [pollStamp, setPollStamp] = useState(0)
  const pollingRef = useRef<number | null>(null)
  const writingRef = useRef(false)
  const prevHostsRef = useRef<Map<string, boolean>>(new Map())
  const [batchOpen, setBatchOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [info, setInfo] = useState('')
  const { push } = useMessages()

  const requestScan = (id: string) => setScanStamp(s => ({ ...s, [id]: (s[id] ?? 0) + 1 }))

  // 自動讀取狀態：每 3 秒觸發一次後端 poll 並刷新
  useEffect(() => {
    // 控制 useHosts 的內建輪詢
    setPollMs(autoPoll ? 2000 : 0)
    if (!autoPoll) {
      if (pollingRef.current) { window.clearInterval(pollingRef.current); pollingRef.current = null }
      return
    }
    const tick = async () => {
      if (writingRef.current) return
      try {
        const r: any = await pollStatuses()
        const events = (r?.data || r?.events || []) as any[]
        if (Array.isArray(events)) {
          for (const ev of events.slice(0, 200)) {
            const fc = Number(ev?.modbus?.fc)
            // 「Modbus輪詢」專注於送出的指令（不含結果）：
            // - 06/寫入：投遞到 modbusPoll（ok 為 undefined）
            // - 03/讀取：也投遞到 modbusPoll（ok 為 undefined），同時由下方投遞到 dbPollMb 顯示實際結果
            if (fc === 0x06) {
              // 06 寫入：在 Modbus輪詢 投遞送出紀錄（不含結果）
              const hostName = (()=>{ try { return (hosts.find(h=>h.id===ev?.hostId)?.name || ev?.hostId || '') } catch { return ev?.hostId || '' } })()
              const m = ev.modbus || {}
              const addr = Number(m.address)
              const addrStr = Number.isFinite(addr) ? `@${addr}` : ''
              const unit = Number(ev?.slaveAddr)
              const unitStr = Number.isFinite(unit) ? ` #${unit}` : ''
              const text = `${hostName}${unitStr ? ' '+unitStr : ''} 寫入(06) ${addrStr}`.trim()
              push({ channel: 'modbusPoll', level: 'info', ok: undefined, text, hostId: ev?.hostId, slaveAddr: ev?.slaveAddr, action: 'write', target: ev?.target || 'host', modbus: { fc: 0x06, address: Number(m.address), values: Array.isArray(m.values) ? m.values : undefined } })
            } else if (fc === 0x03) {
              const m = ev.modbus || {}
              const addr = Number(m.address)
              const qty = Number(m.quantity)
              const addrStr = Number.isFinite(addr) ? `@${addr}` : ''
              const qtyStr = Number.isFinite(qty) && qty>0 ? ` x${qty}` : ''
              const hostName = (()=>{ try { return (hosts.find(h=>h.id===ev?.hostId)?.name || ev?.hostId || '') } catch { return ev?.hostId || '' } })()
              const unit = Number(ev?.slaveAddr)
              const unitStr = Number.isFinite(unit) ? ` #${unit}` : ''
              const text = `${hostName}${unitStr ? ' '+unitStr : ''} 讀取(03) ${addrStr}${qtyStr}`.trim()
              // 注意：送出紀錄不包含回傳值，避免在 Modbus輪詢 顯示結果
              push({ channel: 'modbusPoll', level: 'info', ok: undefined, text, hostId: ev?.hostId, slaveAddr: ev?.slaveAddr, action: 'read', target: ev?.target || 'host', modbus: { fc: 0x03, address: Number(m.address), quantity: Number(m.quantity) } })
            }
            // 分流：DB 事件 -> dbPollDb；03 讀取 -> dbPollMb
            if (ev?.db) {
              const d = ev.db || {}
              const op = (d.op ? String(d.op).toUpperCase() : '')
              const cols = Array.isArray(d.columns) && d.columns.length ? ` (${d.columns.join(',')})` : ''
              const tbl = d.table || ''
              const text = `DB ${op} ${tbl}${cols}`.trim()
              push({ channel: 'dbPollDb', level: 'info', text, ...ev })
            }
            if (fc === 0x03) {
              const m = ev.modbus || {}
              const addr = Number(m.address)
              const qty = Number(m.quantity)
              const vals = Array.isArray(m.values) ? m.values : []
              const addrStr = Number.isFinite(addr) ? `@${addr}` : ''
              const qtyStr = Number.isFinite(qty) && qty>0 ? ` x${qty}` : ''
              const hostName = (()=>{ try { return (hosts.find(h=>h.id===ev?.hostId)?.name || ev?.hostId || '') } catch { return ev?.hostId || '' } })()
              const unit = Number(ev?.slaveAddr)
              const unitStr = Number.isFinite(unit) ? ` #${unit}` : ''
              const text = `${hostName}${unitStr ? ' '+unitStr : ''} 讀取(03) ${addrStr}${qtyStr}`.trim()
              push({ channel: 'dbPollMb', level: ev?.ok === false ? 'warning' : 'info', text, ...ev })
            } else if (fc === 0x06) {
              // 若後端將 06 寫入結果事件帶回（少見），也同步投遞到 資料庫輪詢(Modbus)
              const m = ev.modbus || {}
              const addr = Number(m.address)
              const addrStr = Number.isFinite(addr) ? `@${addr}` : ''
              const hostName = (()=>{ try { return (hosts.find(h=>h.id===ev?.hostId)?.name || ev?.hostId || '') } catch { return ev?.hostId || '' } })()
              const unit = Number(ev?.slaveAddr)
              const unitStr = Number.isFinite(unit) ? ` #${unit}` : ''
              const text = `${hostName}${unitStr ? ' '+unitStr : ''} 寫入(06) ${addrStr}`.trim()
              push({ channel: 'dbPollMb', level: ev?.ok === false ? 'warning' : 'success', text, ...ev })
            }
          }
          if (events.length === 0) {
            push({ channel: 'modbusPoll', level: 'info', text: 'Modbus 輪詢完成' })
          } else {
            push({ channel: 'modbusPoll', level: 'info', text: `輪詢完成：${events.length} 條更新` })
          }
        } else {
          push({ channel: 'modbusPoll', level: 'info', text: 'Modbus 輪詢完成' })
        }
      } catch {}
      try {
        await refresh()
        setPollStamp((s) => s + 1)
        // 產生主機連線變更摘要
        const curMap = new Map(hosts.map(h => [h.id, !!h.connected]))
        const prev = prevHostsRef.current
        let up: string[] = []
        let down: string[] = []
        for (const [id, conn] of curMap) {
          const was = prev.get(id)
          if (typeof was === 'boolean' && was !== conn) { (conn ? up : down).push(id) }
        }
        if (up.length || down.length) {
          const sample = [...up.slice(0,2).map(id=>`${id}↑`), ...down.slice(0,2).map(id=>`${id}↓`)].join(', ')
          const extra = Math.max(0, up.length + down.length - 4)
          const tail = extra ? `，另有 ${extra} 台` : ''
          push({ channel: 'web', level: 'info', text: `網頁輪詢：主機狀態更新 ↑${up.length} ↓${down.length}（共 ${hosts.length} 台）${sample ? '，變更：'+sample : ''}${tail}` })
        }
        prevHostsRef.current = curMap
      } catch {}
    }
    tick()
    pollingRef.current = window.setInterval(tick, 3000)
    return () => { if (pollingRef.current) { window.clearInterval(pollingRef.current); pollingRef.current = null } }
  }, [autoPoll, refresh])

  const commitHostField = async (row: any, field: 'id'|'ip'|'port'|'unitId', value: string | number) => {
    try {
      // UI 驗證：重複 IP 檢查（僅在修改 IP 時）
      if (field === 'ip') {
        const nextIp = String(value || '').trim()
        if (nextIp) {
          const dup = hosts.some(h => h.id !== row.id && String(h.ip||'').trim() === nextIp)
          if (dup) {
            setInfo(`IP 重複：${nextIp} 已被其他主機使用`)
            setInfoOpen(true)
            return
          }
        }
      }
      const payload: HostConfig = {
        id: field === 'id' ? String(value) : String(row.id),
        ip: field === 'ip' ? String(value) : String(row.ip ?? ''),
        port: field === 'port' ? Number(value) : Number(row.port ?? 502),
        unitId: field === 'unitId' ? Number(value) : Number(row.unitId ?? 1),
      }
      await upsertHost(payload)
      try {
        push({ channel: 'web', level: 'info', text: `DB 更新：host ${payload.id} ${field} → ${String(value)}`,
          hostId: payload.id, target: 'host',
          db: { table: 'site_sw_hosts', op: 'update', columns: [field], values: { [field]: value }, where: `id='${payload.id}'` } })
      } catch {}
      // 若為更名 id，嘗試移除舊 id 避免殘留
      if (field === 'id' && String(value) !== String(row.id)) {
        try { await deleteHost(String(row.id)) } catch {}
        try {
          push({ channel: 'web', level: 'info', text: `DB 刪除：舊 host ${String(row.id)}`,
            hostId: String(row.id), target: 'host',
            db: { table: 'site_sw_hosts', op: 'delete', where: `id='${String(row.id)}'` } })
        } catch {}
      }
      await refresh()
    } catch (e) {
      setInfo('更新主機失敗')
      setInfoOpen(true)
    }
  }
  return (
    <div className="col">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 className="m-0">主 / 從 機狀態</h3>
          <div className="row">
            <Badge color="blue"><span className="mono">{connectedCount}/{hosts.length}</span> 已連線</Badge>
            <Button className="btn--sm btn--outline" onClick={()=>refresh()} disabled={loading}>重新整理</Button>
            <Button className="btn--sm" onClick={()=> setBatchOpen(true)}>批量新增主機</Button>
            <Button className="btn--sm btn--outline" onClick={async()=>{
              let ok=0, fail=0
              for (const h of hosts) { try { await connect({ id:h.id, ip:String(h.ip||''), port:Number(h.port||502), unitId:Number(h.unitId||1) }); ok++ } catch { fail++ } }
              setInfo(`全部連線完成：成功 ${ok} 台，失敗 ${fail} 台`); setInfoOpen(true)
              try { await refresh({ silent: true } as any) } catch {}
            }}>全部連線</Button>
            <Button className="btn--sm btn--outline" onClick={async()=>{
              let ok=0, fail=0
              for (const h of hosts) { try { await disconnect(h.id); ok++ } catch { fail++ } }
              setInfo(`全部斷線完成：成功 ${ok} 台，失敗 ${fail} 台`); setInfoOpen(true)
              try { await refresh({ silent: true } as any) } catch {}
            }}>全部斷線</Button>
            <Button className="btn--sm" disabled={scanning} onClick={async()=>{
              setScanning(true)
              try {
                // 後端全域掃描：僅掃描已連線主機
                await scanAllSlaves()
              } catch {}
              try {
                // 重新抓取主機清單與子表狀態
                await refresh()
                setPollStamp((s)=> s+1)
              } finally {
                setScanning(false)
              }
            }}>
              {scanning ? '搜尋中…' : '批量搜尋從機'}
            </Button>
            <Button className="btn--sm" onClick={()=> setAutoPoll(v=>!v)}>
              {autoPoll ? '關閉自動讀取狀態' : '自動讀取狀態'}
            </Button>
          </div>
        </div>
        {error && <div className="text-muted">{error}</div>}
        {hosts.length === 0 && (
          <div className="text-muted" style={{ marginTop: 6 }}>
            目前沒有主機資料。
          </div>
        )}
        <div style={{ paddingTop: 12 }}>
          <SmartTable
            columns={[
              { key: 'name', title: '主機名稱', sortable: true, render: (v, r:any) => (
                <InlineEditableCell value={String(r.name || r.id || '')} onCommit={async (val)=>{
                  const next = String(val)
                  try { await import('@/api/sites/service').then(m=> m.patchHostById(r.id, { name: next })) } catch {}
                }} />
              ) },
              { key: 'ip', title: 'IP', sortable: true, className: 'mono', render: (v, r:any) => (
                <InlineEditableCell value={String(v ?? '')} onCommit={(val)=>commitHostField(r, 'ip', val)} />
              ) },
              { key: 'port', title: 'Port', sortable: true, className: 'mono', render: (v, r:any) => (
                <InlineEditableCell value={Number(v ?? 0)} type="number" onCommit={(val)=>commitHostField(r, 'port', Number(val))} />
              ) },
              { key: 'unitId', title: 'Unit ID', sortable: true, className: 'mono', render: (v, r:any) => (
                <InlineEditableCell value={Number(v ?? 0)} type="number" onCommit={(val)=>commitHostField(r, 'unitId', Number(val))} />
              ) },
              { key: 'connected', title: '狀態', sortable: true, render: (_v, h) => (h.connected ? <Badge color="green">已連線</Badge> : <Badge color="red">未連線</Badge>) },
            ]}
            data={shownHosts}
            rowKey={(h)=>h.id}
            renderActions={(h:any)=> (
              <div className="row" style={{ gap: 6 }}>
                <button className="icon-btn icon-only" title="連線" onClick={()=> connect({ id: h.id, ip: h.ip, port: h.port, unitId: h.unitId })}>
                  <IconLink />
                </button>
                <button className="icon-btn icon-only" title="斷線" onClick={()=> disconnect(h.id)}>
                  {/* 以斜線鏈結代表斷線 */}
                  <IconLink style={{ transform: 'rotate(45deg)', opacity: .85 }} />
                </button>
                <button className="icon-btn icon-only" title="搜尋從機" onClick={()=> requestScan(h.id)}>
                  {/* 使用眼睛圖示代表掃描/檢視 */}
                  {/* 若需更明確可於 icons.tsx 新增放大鏡圖示 */}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                </button>
                <button className="icon-btn icon-only" title="刪除" onClick={async()=> { await deleteHost(h.id); await refresh() }}>
                  <IconTrash />
                </button>
              </div>
            )}
            expandable={{
              expandedRowRender: (h) => (
                <SlaveSubtable
                  hostId={h.id}
                  baseAddr={h.unitId ?? 1}
                  hostConnected={!!h.connected}
                  scanStamp={scanStamp[h.id] ?? 0}
                  pollStamp={pollStamp}
                  onWritingChange={(w:boolean)=> { writingRef.current = w }}
                />
              )
            }}
          />
        </div>
        <BatchAddHostsModal
          isOpen={batchOpen}
          onClose={()=> setBatchOpen(false)}
          onAdded={async ()=> { await refresh() }}
        />
        <Modal isOpen={infoOpen} onClose={()=> setInfoOpen(false)} title="訊息">
          <div className="col" style={{ gap: 12 }}>
            <div>{info}</div>
            <div className="row" style={{ justifyContent:'flex-end' }}>
              <Button className="btn--outline" onClick={()=> setInfoOpen(false)}>關閉</Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  )
}

type SlaveType = 'SL-SW8CH' | 'SL-1-10V4CHDIM'

type SlaveRow = {
  id: string
  name?: string
  addr: number
  type: SlaveType
  connected?: boolean
  enabled?: boolean
  sw?: boolean[]
  // DIM 狀態分離：on/off 以 mask 控制，亮度以 values 控制
  dimMask?: boolean[]
  dimValues?: number[]
}

function SlaveSubtable({ hostId, baseAddr, hostConnected, scanStamp, pollStamp, onWritingChange }: { hostId: string; baseAddr: number; hostConnected: boolean; scanStamp: number; pollStamp: number; onWritingChange?: (w:boolean)=>void }) {
  // 以 DB 為真：rows 從後端狀態載入，使用者變更會立即寫回 DB
  const [rows, setRows] = useState<SlaveRow[]>([])
  const { push } = useMessages()

  // 初始載入：用站號 1..n 的簡易預設幾列（若後端尚無資料時提供 UI 操作入口）
  useEffect(() => {
    // 先以最近的狀態喚入（會在下面 effect 再合併一次以確保最新）
    (async () => {
      try {
        const res: any = await listSlavesByHost(hostId)
        const list: any[] = res?.data || res || []
        if (!Array.isArray(list)) return
        const units = list.map(s => Number(s.unitId)).filter(n => Number.isFinite(n))
        const uniqUnits = Array.from(new Set(units)).sort((a,b)=>a-b)
        const initRows: SlaveRow[] = uniqUnits.map(u => {
          const it = list.find(s=>Number(s.unitId)===u)
          const name = String((it as any)?.name || '')
          return ({ id: `${hostId}-${u}`, name, addr: u, type: (it?.type as any) || 'SL-SW8CH', connected: !!(it?.connected), enabled: !!(it?.enabled) })
        })
        setRows(initRows)
      } catch {}
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId])

  // 當觸發『搜尋從機』時，向後端取得最新列表（由下方 useEffect 合併負責）
  useEffect(() => { /* no-op: 交由合併狀態的 effect 處理 */ }, [scanStamp])

  const handleTypeChange = async (rid: string, next: SlaveType) => {
    const row = rows.find(r => r.id === rid)
    if (!row) return
    try {
      await setSlaveType(hostId, row.addr, next)
      push({ channel: 'web', level: 'info', text: `DB 更新：${hostId} #${row.addr} type → ${next}`,
        hostId, slaveAddr: row.addr, target: 'slave',
        db: { table: 'site_sw_slaves', op: 'update', columns: ['desired_type'], values: { desired_type: next }, where: `host_id='${hostId}' AND slave_unit_id=${row.addr}` } })
    } catch {}
    setRows(prev => prev.map(r => (r.id === rid ? { ...r, type: next } : r)))
  }

  const toggleSw = (rid: string, idx: number, on: boolean) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rid || r.type !== 'SL-SW8CH' || !r.sw) return r
      const sw = r.sw.slice(); sw[idx] = on
      // 計算 8-bit mask 並送出
      const mask = sw.reduce((acc, v, i) => acc | ((v ? 1 : 0) << i), 0)
      const unit = r.addr
      // 非阻塞送出；離線則排隊
      onWritingChange?.(true)
      const addr = sw8MaskAddress(unit)
      writeOrQueue(hostId, addr, mask, () => !!hostConnected)
        .then((ok)=>{
          push({
            channel: 'web', level: ok ? 'success' : 'warning',
            text: `SW8 寫入：${hostId} #${unit} @${addr} = ${mask}`,
            hostId, slaveAddr: unit, action: 'write', ok,
            target: 'slave',
            modbus: { fc: 0x06, address: addr, values: [mask] },
            light: { type: 'SW8', sw }
          })
        })
        .catch(()=>{
          push({
            channel: 'web', level: 'error',
            text: `SW8 寫入失敗：${hostId} #${unit} @${addr} = ${mask}`,
            hostId, slaveAddr: unit, action: 'write', ok: false,
            target: 'slave',
            modbus: { fc: 0x06, address: addr, values: [mask] },
            light: { type: 'SW8', sw }
          })
        })
        .finally(()=> onWritingChange?.(false))
      return { ...r, sw }
    }))
  }

  const setDimVal = (rid: string, idx: number, value: number) => {
    const v = Math.max(0, Math.min(255, Math.round(value)))
    setRows(prev => prev.map(r => {
      if (r.id !== rid || r.type !== 'SL-1-10V4CHDIM') return r
      const dimValues = (r.dimValues ? r.dimValues.slice() : [0, 0, 0, 0])
      dimValues[idx] = v
      // 單通道 0..255 寫入
      const unit = r.addr
      onWritingChange?.(true)
      const addr = dimValueAddress(unit, idx)
      writeOrQueue(hostId, addr, v, () => !!hostConnected)
        .then((ok)=>{
          push({
            channel: 'web', level: ok ? 'success' : 'warning',
            text: `DIM 寫入：${hostId} #${unit} CH${idx+1} @${addr} = ${v}`,
            hostId, slaveAddr: unit, action: 'write', ok,
            target: 'slave',
            modbus: { fc: 0x06, address: addr, values: [v] },
            light: { type: 'DIM4', dimValues }
          })
        })
        .catch(()=>{
          push({
            channel: 'web', level: 'error',
            text: `DIM 寫入失敗：${hostId} #${unit} CH${idx+1} @${addr} = ${v}`,
            hostId, slaveAddr: unit, action: 'write', ok: false,
            target: 'slave',
            modbus: { fc: 0x06, address: addr, values: [v] },
            light: { type: 'DIM4', dimValues }
          })
        })
        .finally(()=> onWritingChange?.(false))
      return { ...r, dimValues }
    }))
  }

  const toggleDimMask = (rid: string, idx: number, next?: boolean) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rid || r.type !== 'SL-1-10V4CHDIM') return r
      const dimMask = (r.dimMask ? r.dimMask.slice() : [false, false, false, false])
      dimMask[idx] = typeof next === 'boolean' ? next : !dimMask[idx]
      // 計算 4-bit mask 並送出
      const maskVal = dimMask.reduce((acc, v, i) => acc | ((v ? 1 : 0) << i), 0)
      const unit = r.addr
      onWritingChange?.(true)
      const addr = dimMaskAddress(unit)
      writeOrQueue(hostId, addr, maskVal, () => !!hostConnected)
        .then((ok)=>{
          push({
            channel: 'web', level: ok ? 'success' : 'warning',
            text: `DIM 遮罩：${hostId} #${unit} @${addr} = ${maskVal}`,
            hostId, slaveAddr: unit, action: 'write', ok,
            target: 'slave',
            modbus: { fc: 0x06, address: addr, values: [maskVal] },
            light: { type: 'DIM4', dimValues: r.dimValues ?? [0,0,0,0] }
          })
        })
        .catch(()=>{
          push({
            channel: 'web', level: 'error',
            text: `DIM 遮罩失敗：${hostId} #${unit} @${addr} = ${maskVal}`,
            hostId, slaveAddr: unit, action: 'write', ok: false,
            target: 'slave',
            modbus: { fc: 0x06, address: addr, values: [maskVal] },
            light: { type: 'DIM4', dimValues: r.dimValues ?? [0,0,0,0] }
          })
        })
        .finally(()=> onWritingChange?.(false))
      return { ...r, dimMask }
    }))
  }

  // 從後端讀取該 host 的最新從機狀態並合併（在 scan 或 pollStamp 變化時觸發）
  useEffect(() => {
    let disposed = false
    const run = async () => {
      try {
        const res: any = await listSlavesByHost(hostId)
        const list: any[] = res?.data || res || []
        if (!Array.isArray(list) || disposed) return
        const byUnit: Record<number, any> = {}
        for (const s of list) {
          const unitId = Number(s.unitId ?? s.unit_id ?? s.addr)
          if (!Number.isFinite(unitId)) continue
          byUnit[unitId] = s
        }
        setRows(prev => {
          const updated = prev.map(r => {
            const cur = byUnit[r.addr]
            if (!cur) return r
            const connected = !!(cur.connected ?? cur.isConnected)
            const enabled = !!(cur.enabled ?? cur.isEnabled)
            const name = String((cur as any)?.name || r.name || '')
            if (r.type === 'SL-SW8CH') {
              const mask = Number(cur.swMaskCurrent ?? cur.sw_mask_current ?? 0)
              const sw = Array(8).fill(false).map((_, i) => !!(mask & (1 << i)))
              return { ...r, connected, enabled, sw, name }
            } else if (r.type === 'SL-1-10V4CHDIM') {
              const mask4 = Number(cur.dimMaskCurrent ?? cur.dim_mask_current ?? 0)
              const dimMask = Array(4).fill(false).map((_, i) => !!(mask4 & (1 << i)))
              const rawVals = (cur.dimValuesCurrent ?? cur.dim_values_current)
              const dimValues = Array.isArray(rawVals) ? rawVals.slice(0, 4) : [0, 0, 0, 0]
              while (dimValues.length < 4) dimValues.push(0)
              return { ...r, connected, enabled, dimMask, dimValues, name }
            }
            return r
          })
          // append new units not in prev
          const existing = new Set(updated.map(r => r.addr))
          for (const unitStr of Object.keys(byUnit)) {
            const u = Number(unitStr)
            if (!existing.has(u)) {
              const cur = byUnit[u]
              const type = cur?.type || 'SL-SW8CH'
              updated.push({ id: `${hostId}-${u}`, addr: u, type, connected: !!cur?.connected, enabled: !!cur?.enabled })
            }
          }
          return updated
        })
      } catch {}
    }
    run()
    return () => { disposed = true }
  }, [hostId, scanStamp, pollStamp])

  const columns = useMemo(() => ([
    { key: 'name', title: '從機名稱', sortable: true, className: 'mono', render: (_:any, r:SlaveRow) => (
      <InlineEditableCell value={String((r.name && r.name.trim()) ? r.name : `從機${r.addr}`)} onCommit={async (val)=>{
        try { await import('@/api/sites/service').then(m=> m.patchSlaveByUnit(hostId, r.addr, { name: String(val) })) } catch {}
        setRows(prev => prev.map(x => x.id===r.id ? { ...x, name: String(val) } : x))
      }} />
    ) },
    { key: 'addr', title: '站號', sortable: true, className: 'mono', render: (v:any, r:SlaveRow) => (
      <InlineEditableCell value={Number(v ?? 0)} type="number" onCommit={async (val)=>{
        const next = Number(val)
        if (!Number.isFinite(next) || next<1 || next>247) return
        // 檢查重複站號（同一主機）
        const dup = rows.some(x => x.id !== r.id && x.addr === next)
        if (dup) { push({ channel:'web', level:'warning', text:`站號重複：#${next} 已存在` }); return }
        try { await import('@/api/sites/service').then(m=> m.patchSlaveByUnit(hostId, r.addr, { unitId: next })) } catch {}
        // 本地立即更新鍵值
        setRows(prev => prev.map(x => x.id===r.id ? { ...x, id: `${hostId}-${next}`, addr: next } : x))
      }} />
    ) },
    { key: 'connected', title: '狀態', sortable: false, render: (_:any, r:SlaveRow) => (
      r.connected ? <Badge color="green">已連線</Badge> : <Badge color="red">未連線</Badge>
    ) },
    { key: 'enabled', title: '是否啟用', sortable: false, render: (_: any, r: SlaveRow) => (
      <Select
        size="sm"
        value={String(r.enabled ? '1' : '0')}
        onChange={async (v)=> {
          const next = v === '1'
          try {
            await setSlaveEnabled(hostId, r.addr, next)
            push({ channel: 'web', level: 'info', text: `DB 更新：${hostId} #${r.addr} enabled → ${next?'1':'0'}`,
              hostId, slaveAddr: r.addr, target: 'slave',
              db: { table: 'site_sw_slaves', op: 'update', columns: ['desired_enabled'], values: { desired_enabled: next?1:0 }, where: `host_id='${hostId}' AND slave_unit_id=${r.addr}` } })
          } catch {}
          setRows(prev => prev.map(x => x.id === r.id ? { ...x, enabled: next } : x))
        }}
        options={[{ label: '否', value: '0' }, { label: '是', value: '1' }]}
      />
    ) },
    { key: 'type', title: '從機類型', sortable: false, render: (_: any, r: SlaveRow) => (
      <Select
        size="sm"
        value={r.type}
        onChange={(v)=>handleTypeChange(r.id, v as SlaveType)}
        options={[
          { label: 'SL-SW8CH', value: 'SL-SW8CH' },
          { label: 'SL-1-10V4CHDIM', value: 'SL-1-10V4CHDIM' },
        ]}
      />
    ) },
  ]), [])

  return (
    <div>
      <div className="text-muted">從機資訊（可選擇類型：SL-SW8CH 或 SL-1-10V4CHDIM）</div>
      <div style={{ paddingTop: 8 }}>
        <SmartTable
          columns={columns as any}
          data={rows as any}
          rowKey={(r: any)=>r.id}
          actionsClassName="lights"
          renderActions={(row: SlaveRow) => (
            <>
              {row.type === 'SL-SW8CH' && (
                <div className="light-group">
                  {(row.sw ?? Array(8).fill(false)).map((on, i) => (
                    <LightButton key={i} size="sm" on={on} title={`CH${i+1}`} onChange={(v)=>toggleSw(row.id, i, v)} />
                  ))}
                </div>
              )}
              {row.type === 'SL-1-10V4CHDIM' && (
                <div className="dim-group">
                  {(row.dimValues ?? [0, 0, 0, 0]).map((val, i) => {
                    const mask = row.dimMask ?? [false, false, false, false]
                    const on = !!mask[i]
                    return (
                      <div className="dim-pair" key={i}>
                        <LightButton
                          size="sm"
                          on={on}
                          title={`通道 ${i+1}`}
                          onChange={(next)=> toggleDimMask(row.id, i, next)}
                        />
                        <NumberInput
                          className="dim-input"
                          value={val}
                          min={0}
                          max={255}
                          step={1}
                          onChange={(n)=> setDimVal(row.id, i, n)}
                          size="sm"
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        />
      </div>
    </div>
  )
}

// 批量新增主機 Modal
function BatchAddHostsModal({ isOpen, onClose, onAdded }: { isOpen: boolean; onClose: () => void; onAdded?: () => Promise<void> | void }) {
  const [startIp, setStartIp] = useState('')
  const [endIp, setEndIp] = useState('')
  const [step, setStep] = useState<number>(1)
  const [namePrefix, setNamePrefix] = useState<string>('主機')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string>('')

  type IPInfo = { prefix: string; start: number; end: number }
  const parseIpRange = (s: string, e: string): { ok: true; info: IPInfo } | { ok: false; reason: string } => {
    const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
    const ms = s.trim().match(ipRegex)
    const me = e.trim().match(ipRegex)
    if (!ms || !me) return { ok: false, reason: 'IP 格式不正確，請輸入如 192.168.0.1 的 IPv4。' }
    const [ , a1, a2, a3, a4 ] = ms.map(Number) as any
    const [ , b1, b2, b3, b4 ] = me.map(Number) as any
    const inByte = (n:number)=> n>=0 && n<=255
    if (![a1,a2,a3,a4,b1,b2,b3,b4].every(inByte)) return { ok: false, reason: '每段 IP 必須在 0..255。' }
    if (a1!==b1 || a2!==b2 || a3!==b3) return { ok: false, reason: '目前僅支援同網段（前 3 段相同）的範圍。' }
    if (a4 > b4) return { ok: false, reason: '起始 IP 需小於或等於結束 IP。' }
    return { ok: true, info: { prefix: `${a1}.${a2}.${a3}`, start: a4, end: b4 } }
  }

  const genTasks = (info: IPInfo, stepVal: number) => {
    const list: { id: string; name: string; ip: string; port: number; unitId: number }[] = []
    const s = info.start
    const e = info.end
    for (let last = s; last <= e; last += stepVal) {
      const id = `${namePrefix}${last}`
      const name = `${namePrefix}${last}`
      const ip = `${info.prefix}.${last}`
      list.push({ id, name, ip, port: 5000, unitId: 1 })
    }
    return list
  }

  const onSubmit = async () => {
    setMessage('')
    const sv = Number(step)
    if (!Number.isFinite(sv) || sv <= 0 || sv > 255) {
      setMessage('累加間隔需為 1..255 的整數。')
      return
    }
    const parsed = parseIpRange(startIp, endIp)
    if (!parsed.ok) { setMessage(parsed.reason); return }
    const tasks = genTasks(parsed.info, sv)
    if (tasks.length === 0) { setMessage('沒有可新增的主機。'); return }
    setSubmitting(true)
    let ok = 0, fail = 0
    try {
      for (const t of tasks) {
        try {
          await upsertHost({ id: t.id, ip: t.ip, port: t.port, unitId: t.unitId })
          // 將名稱寫入 DB（若提供 Sites API），以便狀態頁顯示名稱
          try { await import('@/api/sites/service').then(m=> m.patchHostById(t.id, { name: t.name })) } catch {}
          ok++
        } catch {
          fail++
        }
      }
      setMessage(`完成：成功 ${ok} 台，失敗 ${fail} 台。`)
      try { await onAdded?.() } catch {}
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = !!startIp && !!endIp && step >= 1 && !submitting

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="批量新增主機" maxWidth={560}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="col" style={{ flex: 1 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>起始 IP</div>
            <Input value={startIp} placeholder="例如 192.168.0.1" onChange={(e)=> setStartIp(e.currentTarget.value)} />
          </div>
          <div className="col" style={{ flex: 1 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>結束 IP</div>
            <Input value={endIp} placeholder="例如 192.168.0.255" onChange={(e)=> setEndIp(e.currentTarget.value)} />
          </div>
        </div>
        <div className="col" style={{ gap: 6 }}>
          <div className="text-muted" style={{ marginBottom: 4 }}>名稱前綴</div>
          <Input value={namePrefix} onChange={(e)=> setNamePrefix(e.currentTarget.value)} placeholder="例如 主機" />
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="col" style={{ width: 180 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>累加間隔</div>
            <NumberInput value={step} min={1} max={255} step={1} onChange={(v)=> setStep(Number(v))} />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Button className="btn--sm btn--outline" disabled={!canSubmit} onClick={onSubmit}>
              {submitting ? '新增中…' : '開始新增'}
            </Button>
            <Button className="btn--sm" onClick={onClose} disabled={submitting}>關閉</Button>
          </div>
        </div>
        <div className="text-muted" style={{ minHeight: 20 }}>{message}</div>
        <div className="text-muted" style={{ fontSize: 12 }}>
          規則：僅變動最後一段 IP，名稱與主機 ID 皆以「名稱前綴+最後一段」為預設；Port=5000，Unit ID=1。
        </div>
      </div>
    </Modal>
  )
}
