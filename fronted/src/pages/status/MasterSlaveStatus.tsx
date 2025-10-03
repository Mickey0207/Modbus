import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, SmartTable, LightButton, Select, Input, InlineEditableCell, NumberInput, Modal } from '@/components/index'
import { IconLink, IconTrash, IconPlus } from '@/components/common/icons'
import useHosts from '@/hooks/useHosts'
import { upsertHost, deleteHost, type HostConfig } from '@/api/hosts/registry'
import { writeOrQueue } from '@/api/modbus/operations'
import { pollStatuses, listSlavesByHost, setSlaveType } from '@/api'
import { sw8MaskAddress, dimMaskAddress, dimValueAddress } from '@/api/modbus'
import { useMessages, useChannelLoggers } from '@/components/contexts/MessagesContext'

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
  const [batchAddSlavesHost, setBatchAddSlavesHost] = useState<any|null>(null)
  
  const [infoOpen, setInfoOpen] = useState(false)
  const [info, setInfo] = useState('')
  const { push } = useMessages()
  const log = useChannelLoggers()

  // ===== 全域/主機「群組寸動」狀態與同步 =====
  type QuickSel = { group?: string; scene?: string }
  const [globalQuick, setGlobalQuick] = useState<QuickSel>({ group:'', scene:'' })
  const [hostQuick, setHostQuick] = useState<Record<string, QuickSel>>({})
  const [slaveQuick, setSlaveQuick] = useState<Record<string, QuickSel>>({})
  const groupKey = (hostId:string) => hostId
  const slaveKey = (hostId:string, unit:number) => `${hostId}#${unit}`
  const onGlobalQuickChange = (mode:'group'|'scene', value:string) => {
    const other: 'group'|'scene' = mode === 'group' ? 'scene' : 'group'
    const clearOther = value !== ''
    setGlobalQuick(prev => ({ ...prev, [mode]: value, [other]: clearOther ? '' : prev[other] }))
    // propagate to hosts
    setHostQuick(prev => {
      const next = { ...prev } as Record<string, QuickSel>
      for (const h of hosts) next[groupKey(h.id)] = { ...(next[groupKey(h.id)]||{}), [mode]: value, [other]: clearOther ? '' : (next[groupKey(h.id)]?.[other]) }
      return next
    })
    // propagate to slaves (lazy: actual application will happen when executing feature later)
    setSlaveQuick(prev => {
      const next = { ...prev } as Record<string, QuickSel>
      // slaves are dynamic; apply when expanded usage happens
      return next
    })
  }
  const onHostQuickChange = (hostId:string, mode:'group'|'scene', value:string) => {
    const other: 'group'|'scene' = mode === 'group' ? 'scene' : 'group'
    const clearOther = value !== ''
    setHostQuick(prev => ({ ...prev, [groupKey(hostId)]: { ...(prev[groupKey(hostId)]||{}), [mode]: value, [other]: clearOther ? '' : (prev[groupKey(hostId)]?.[other]) } }))
    // Note: we don't have slave list here globally; per-subtable we'll mirror down when rendering actions
  }
  const onSlaveQuickChange = (hostId:string, unitId:number, mode:'group'|'scene', value:string) => {
    const other: 'group'|'scene' = mode === 'group' ? 'scene' : 'group'
    const clearOther = value !== ''
    setSlaveQuick(prev => ({ ...prev, [slaveKey(hostId, unitId)]: { ...(prev[slaveKey(hostId, unitId)]||{}), [mode]: value, [other]: clearOther ? '' : (prev[slaveKey(hostId, unitId)]?.[other]) } }))
  }

  // 若尚無主機，預設加入範例主機（僅前端記憶體）
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    if (!hosts || hosts.length > 0) return
    seededRef.current = true
    ;(async()=>{
      try {
        await upsertHost({ id: 'demo-host-1', name: '示例主機1', ip: '192.168.0.100', port: 502, unitId: 1 })
        await upsertHost({ id: 'demo-host-2', name: '示例主機2', ip: '192.168.0.101', port: 502, unitId: 1 })
        // 確保 Sites DB 也有至少一個主機與示例從機，方便子表格展開
        try {
          const svc = await import('@/api/sites/service')
          const sites = await svc.listSites()
          const site = sites[0] || await svc.createSite('示範案場（狀態）')
          let hostId = site.hosts[0]?.id
          if (!hostId) {
            const r = await svc.addHost(site.id, { name: '主機A', ip: '192.168.0.200', port: 502, unitId: 1, floor: '1F', room: '機房A', note: '示例', slaves: [] })
            hostId = r.id
          }
          const curSlaves = await svc.listSlavesByHostId(hostId)
          const has1 = curSlaves.some(s=>s.unitId===1)
          const has2 = curSlaves.some(s=>s.unitId===2)
          if (!has1) await svc.addSlave(hostId, { unitId: 1, name: '示例從機1', type: 'SL-SW8CH', enabled: true, swMask: 0 })
          if (!has2) await svc.addSlave(hostId, { unitId: 2, name: '示例從機2', type: 'SL-1-10V4CHDIM', enabled: true, dimMask: 0, dimValues: [0,0,0,0] })
        } catch {}
      } finally {
        try { await refresh() } catch {}
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosts?.length])

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
            // 傳送事件僅紀錄送出，不帶結果；實際結果在下方 DB 分流中處理
            // - 06/寫入：投遞到 modbusPoll（ok 為 undefined）
            // - 03/讀取：也投遞到 modbusPoll（ok 為 undefined），同時由下方投遞到 dbPollMb 顯示實際結果
            if (fc === 0x06) {
              // 06 寫入：投遞送出紀錄（不含結果）
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
              // 注意：送出紀錄不包含回傳值，避免在 modbusPoll 顯示結果
              push({ channel: 'modbusPoll', level: 'info', ok: undefined, text, hostId: ev?.hostId, slaveAddr: ev?.slaveAddr, action: 'read', target: ev?.target || 'host', modbus: { fc: 0x03, address: Number(m.address), quantity: Number(m.quantity) } })
            }
            // 分流：DB 事件 -> dbPollDb；03 讀取 -> dbPollMb
            if (ev?.db) {
              const d = ev.db || {}
              const op = (d.op ? String(d.op).toUpperCase() : '')
              const cols = Array.isArray(d.columns) && d.columns.length ? ` (${d.columns.join(',')})` : ''
              const tbl = d.table || ''
              const text = `DB ${op} ${tbl}${cols}`.trim()
              try { log.dbPollDb.info({ text, ...ev }) } catch { push({ channel:'dbPollDb', level:'info', text, ...ev }) }
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
              try { log.dbPollMb.info({ text, ...ev }) } catch { push({ channel:'dbPollMb', level: ev?.ok === false ? 'warning' : 'info', text, ...ev }) }
            } else if (fc === 0x06) {
              const m = ev.modbus || {}
              const addr = Number(m.address)
              const addrStr = Number.isFinite(addr) ? `@${addr}` : ''
              const hostName = (()=>{ try { return (hosts.find(h=>h.id===ev?.hostId)?.name || ev?.hostId || '') } catch { return ev?.hostId || '' } })()
              const unit = Number(ev?.slaveAddr)
              const unitStr = Number.isFinite(unit) ? ` #${unit}` : ''
              const text = `${hostName}${unitStr ? ' '+unitStr : ''} 寫入(06) ${addrStr}`.trim()
              try { log.dbPollMb.success({ text, ...ev }) } catch { push({ channel:'dbPollMb', level: ev?.ok === false ? 'warning' : 'success', text, ...ev }) }
            }
          }
          // 完成訊息省略（不顯示「Modbus輪詢」或「輪詢完成」文字）
        } else {
          // 無事件時不推送完成訊息
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
        // 變更摘要不再標記「網頁輪詢」，若需顯示可在此自訂文字
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
        log.dbPollDb.info({ text: `DB 更新：host ${payload.id} ${field} → ${String(value)}`,
          hostId: payload.id, target: 'host',
          db: { table: 'site_sw_hosts', op: 'update', columns: [field], values: { [field]: value }, where: `id='${payload.id}'` } })
      } catch {}
      // 若為更名 id，嘗試移除舊 id 避免殘留
      if (field === 'id' && String(value) !== String(row.id)) {
        try { await deleteHost(String(row.id)) } catch {}
        try {
          log.dbPollDb.info({ text: `DB 刪除：舊 host ${String(row.id)}`,
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
          <div className="row" style={{ gap:8, alignItems:'center' }}>
            {/* 全域：群組寸動（含「無」），變更時同步主機層 */}
            <Select
              size="sm"
              placeholder="群組寸動"
              value={(globalQuick.group ?? '') as any}
              onChange={(v)=> onGlobalQuickChange('group', v)}
              options={[{ label: '無', value: '' }, ...Array.from({length:32}).map((_,i)=>({ label: `群組${i+1}`, value: String(i+1) }))]}
            />
            <Badge color="blue"><span className="mono">{connectedCount}/{hosts.length}</span> 已連線</Badge>
            <Button className="btn--sm btn--outline" onClick={()=>refresh()} disabled={loading}>重新整理</Button>
            
            <Button className="btn--sm btn--outline" onClick={async()=>{
              try { log.web.info({ text: '使用者操作：全部連線' }) } catch {}
              let ok=0, fail=0
              for (const h of hosts) { try { await connect({ id:h.id, ip:String(h.ip||''), port:Number(h.port||502), unitId:Number(h.unitId||1) }); ok++ } catch { fail++ } }
              setInfo(`全部連線完成：成功 ${ok} 台，失敗 ${fail} 台`); setInfoOpen(true)
              try { await refresh({ silent: true } as any) } catch {}
              try { log.web.info({ text: `全部連線完成：成功 ${ok} 台，失敗 ${fail} 台` }) } catch {}
            }}>全部連線</Button>
            <Button className="btn--sm btn--outline" onClick={async()=>{
              try { log.web.info({ text: '使用者操作：全部斷線' }) } catch {}
              let ok=0, fail=0
              for (const h of hosts) { try { await disconnect(h.id); ok++ } catch { fail++ } }
              setInfo(`全部斷線完成：成功 ${ok} 台，失敗 ${fail} 台`); setInfoOpen(true)
              try { await refresh({ silent: true } as any) } catch {}
              try { log.web.info({ text: `全部斷線完成：成功 ${ok} 台，失敗 ${fail} 台` }) } catch {}
            }}>全部斷線</Button>
            <Button className="btn--sm" onClick={()=> setBatchOpen(true)}>批量新增主機</Button>
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
                <button className="icon-btn icon-only" title="批量新增從機" onClick={()=> setBatchAddSlavesHost(h)}>
                  <IconPlus />
                </button>
                <button className="icon-btn icon-only" title="刪除" onClick={async()=> { await deleteHost(h.id); await refresh() }}>
                  <IconTrash />
                </button>
                {/* 主機層：群組寸動（含「無」） */}
                <Select
                  size="sm"
                  placeholder="群組寸動"
                  value={(hostQuick[groupKey(h.id)]?.group ?? globalQuick.group ?? '') as any}
                  onChange={(v)=> onHostQuickChange(h.id, 'group', v)}
                  options={[{ label: '無', value: '' }, ...Array.from({length:32}).map((_,i)=>({ label: `群組${i+1}`, value: String(i+1) }))]}
                />
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
                  sharedQuick={{ globalQuick, hostQuick, slaveQuick }}
                  quickHandlers={{ onHostQuickChange, onSlaveQuickChange }}
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
        <BatchAddSlavesModal
          host={batchAddSlavesHost}
          isOpen={!!batchAddSlavesHost}
          onClose={()=> setBatchAddSlavesHost(null)}
          onAdded={async ()=> { await refresh(); setPollStamp(s=>s+1) }}
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
type QuickSel = { group?: string; scene?: string }

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

function SlaveSubtable({ hostId, baseAddr, hostConnected, scanStamp, pollStamp, onWritingChange, sharedQuick, quickHandlers }: { hostId: string; baseAddr: number; hostConnected: boolean; scanStamp: number; pollStamp: number; onWritingChange?: (w:boolean)=>void; sharedQuick: { globalQuick: QuickSel; hostQuick: Record<string, QuickSel>; slaveQuick: Record<string, QuickSel> }; quickHandlers: { onHostQuickChange: (hostId:string, mode:'group'|'scene', v:string)=>void; onSlaveQuickChange: (hostId:string, unit:number, mode:'group'|'scene', v:string)=>void } }) {
  // 以 DB 為真：rows 從後端狀態載入，使用者變更會立即寫回 DB
  const [rows, setRows] = useState<SlaveRow[]>([])
  const { push } = useMessages()
  const log = useChannelLoggers()

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
        let initRows: SlaveRow[] = uniqUnits.map(u => {
          const it = list.find(s=>Number(s.unitId)===u)
          const name = String((it as any)?.name || '')
          return ({ id: `${hostId}-${u}`, name, addr: u, type: (it?.type as any) || 'SL-SW8CH', connected: !!(it?.connected), enabled: !!(it?.enabled) })
        })
        // 若沒有任何從機，加入示例資料（兩種類型各一筆）
        if (initRows.length === 0) {
          initRows = [
            { id: `${hostId}-1`, name: '示例從機1', addr: 1, type: 'SL-SW8CH', connected: hostConnected, enabled: true, sw: Array(8).fill(false) },
            { id: `${hostId}-2`, name: '示例從機2', addr: 2, type: 'SL-1-10V4CHDIM', connected: hostConnected, enabled: true, dimMask: [false,false,false,false], dimValues: [0,0,0,0] }
          ]
        }
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
      log.dbPollDb.info({ text: `DB 更新：${hostId} #${row.addr} type → ${next}`,
        hostId, slaveAddr: row.addr, target: 'slave',
        db: { table: 'site_sw_slaves', op: 'update', columns: ['desired_type'], values: { desired_type: next }, where: `host_id='${hostId}' AND slave_unit_id=${row.addr}` } })
    } catch {}
    // 立即反映到畫面，並依新類型正規化欄位，避免 UI 未更新
    setRows(prev => prev.map(r => {
      if (r.id !== rid) return r
      if (next === 'SL-SW8CH') {
        const sw = Array(8).fill(false)
        return { id: r.id, name: r.name, addr: r.addr, type: next, connected: r.connected, enabled: r.enabled, sw }
      } else {
        const dimMask = [false,false,false,false]
        const dimValues = [0,0,0,0]
        return { id: r.id, name: r.name, addr: r.addr, type: next, connected: r.connected, enabled: r.enabled, dimMask, dimValues }
      }
    }))
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
          ;(ok ? log.modbusSend.success : log.modbusSend.warning)({
            text: `SW8 寫入：${hostId} #${unit} @${addr} = ${mask}`,
            hostId, slaveAddr: unit, action: 'write', ok,
            target: 'slave',
            modbus: { fc: 0x06, address: addr, values: [mask] },
            light: { type: 'SW8', sw }
          })
        })
        .catch(()=>{
          log.modbusSend.error({
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
          ;(ok ? log.modbusSend.success : log.modbusSend.warning)({
            text: `DIM 寫入：${hostId} #${unit} CH${idx+1} @${addr} = ${v}`,
            hostId, slaveAddr: unit, action: 'write', ok,
            target: 'slave',
            modbus: { fc: 0x06, address: addr, values: [v] },
            light: { type: 'DIM4', dimValues }
          })
        })
        .catch(()=>{
          log.modbusSend.error({
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
          ;(ok ? log.modbusSend.success : log.modbusSend.warning)({
            text: `DIM 遮罩：${hostId} #${unit} @${addr} = ${maskVal}`,
            hostId, slaveAddr: unit, action: 'write', ok,
            target: 'slave',
            modbus: { fc: 0x06, address: addr, values: [maskVal] },
            light: { type: 'DIM4', dimValues: r.dimValues ?? [0,0,0,0] }
          })
        })
        .catch(()=>{
          log.modbusSend.error({
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

  // 群組場景表（每個從機一份，僅存在前端狀態）
  type GroupSceneItem = {
    id: string
    index: number
    group?: boolean[]
    scene?: boolean[]
    groupVals?: number[]
    sceneVals?: number[]
  }
  const [groupSceneMap, setGroupSceneMap] = useState<Record<string, GroupSceneItem[]>>({})
  const rid = (hid:string, unit:number) => `${hid}-${unit}`
  const getGs = (hid:string, unit:number) => groupSceneMap[rid(hid, unit)] || []
  const setGs = (hid:string, unit:number, rows: GroupSceneItem[]) => setGroupSceneMap(prev => ({ ...prev, [rid(hid, unit)]: rows }))
  const addGsBatch = (hid:string, unit:number, start:number, end:number, step:number) => {
    const cur = getGs(hid, unit)
    const existing = new Set(cur.map(r => r.index))
    const out: GroupSceneItem[] = [...cur]
    const slave = rows.find(r => r.addr === unit)
    const isDim = slave?.type === 'SL-1-10V4CHDIM'
    const count = isDim ? 4 : 8
    for (let n = start; n <= end; n += step) {
      if (!existing.has(n)) out.push({
        id: crypto.randomUUID?.() || `${Date.now()}-${n}`,
        index: n,
        group: Array(count).fill(false),
        scene: Array(count).fill(false),
        groupVals: isDim ? Array(count).fill(0) : undefined,
        sceneVals: isDim ? Array(count).fill(0) : undefined,
      })
    }
    setGs(hid, unit, out.sort((a,b)=>a.index-b.index))
  }

  // 批量新增群組/場景 Modal 觸發
  const [batchGs, setBatchGs] = useState<{ hostId: string; unitId: number } | null>(null)

  // 場景→群組對應（每從機一份）
  const [sceneGroupMap, setSceneGroupMap] = useState<Record<string, Record<number, number[]>>>({})

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
            const type: SlaveType = (cur?.type as SlaveType) || r.type
            if (type === 'SL-SW8CH') {
              const mask = Number(cur.swMaskCurrent ?? cur.sw_mask_current ?? 0)
              const sw = Array(8).fill(false).map((_, i) => !!(mask & (1 << i)))
              return { ...r, type, connected, enabled, sw, name }
            } else if (type === 'SL-1-10V4CHDIM') {
              const mask4 = Number(cur.dimMaskCurrent ?? cur.dim_mask_current ?? 0)
              const dimMask = Array(4).fill(false).map((_, i) => !!(mask4 & (1 << i)))
              const rawVals = (cur.dimValuesCurrent ?? cur.dim_values_current)
              const dimValues = Array.isArray(rawVals) ? rawVals.slice(0, 4) : [0, 0, 0, 0]
              while (dimValues.length < 4) dimValues.push(0)
              return { ...r, type, connected, enabled, dimMask, dimValues, name }
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
        if (dup) { try { log.web.warning({ text:`站號重複：#${next} 已存在` }) } catch {}; return }
        try { await import('@/api/sites/service').then(m=> m.patchSlaveByUnit(hostId, r.addr, { unitId: next })) } catch {}
        // 本地立即更新鍵值
        setRows(prev => prev.map(x => x.id===r.id ? { ...x, id: `${hostId}-${next}`, addr: next } : x))
      }} />
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
            <div className="row" style={{ gap: 6 }}>
              <button className="icon-btn icon-only" title="刪除" onClick={async()=>{
                try {
                  const api = await import('@/api/sites/service')
                  await api.deleteSlaveByUnit(hostId, row.addr)
                  setRows(prev => prev.filter(r => r.id !== row.id))
                  try { push({ channel: 'web', level: 'info', text: `DB 刪除：${hostId} #${row.addr}` }) } catch {}
                } catch {}
              }}>
                <IconTrash />
              </button>
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
              {/* 從機層「群組寸動」下拉已移除（保留主機/全域層級） */}
            </div>
          )}
          expandable={{
            expandedRowRender: (row: SlaveRow) => (
              <div className="subtable">
                <div className="row" style={{ justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <div className="text-muted">群組場景表</div>
                  <Button className="btn--outline" onClick={()=> setBatchGs({ hostId, unitId: row.addr })}>批量新增群組/場景</Button>
                </div>
                <SmartTable
                  columns={([
                    { key:'index', title:'編號', width:120, render:(v:any, r:GroupSceneItem)=> (
                      <InlineEditableCell
                        value={Number(v)}
                        type="number"
                        className="mono"
                        onCommit={(n)=> setGs(hostId, row.addr, getGs(hostId, row.addr).map(x=> x.id===r.id ? { ...x, index: Number(n)||1 } : x).sort((a,b)=>a.index-b.index))}
                      />
                    ) },
                    { key:'groupLights', title:'群組燈號', width:320, render:(_v:any, r:GroupSceneItem)=> {
                      const isDim = row.type === 'SL-1-10V4CHDIM'
                      const count = isDim ? 4 : 8
                      const ensure = (it: GroupSceneItem) => {
                        const g = (it.group && it.group.length===count) ? it.group : Array(count).fill(false)
                        const gv = isDim ? ((it.groupVals && it.groupVals.length===count) ? it.groupVals : Array(count).fill(0)) : undefined
                        return { g, gv }
                      }
                      const { g, gv } = ensure(r)
                      return (
                        <div className={isDim? 'dim-group':'light-group'} style={isDim? undefined : { gridTemplateColumns: `repeat(${count}, minmax(28px, 1fr))` }}>
                          {Array.from({ length: count }).map((_, i) => (
                            isDim ? (
                              <div className="dim-pair" key={i}>
                                <LightButton size="sm" color="red" on={!!g[i]} onChange={(next)=> setGs(hostId, row.addr, getGs(hostId, row.addr).map(x=> x.id===r.id ? { ...x, group: (()=>{ const arr = (x.group && x.group.length===count ? [...x.group] : Array(count).fill(false)); arr[i]=next; return arr })(), groupVals: (()=>{ const arr = (x.groupVals && x.groupVals.length===count ? [...x.groupVals] : Array(count).fill(0)); return arr })() } : x))} />
                                <NumberInput className="dim-input" size="sm" value={Number(gv?.[i] ?? 0)} min={0} max={255} step={1} onChange={(n)=> setGs(hostId, row.addr, getGs(hostId, row.addr).map(x=> x.id===r.id ? { ...x, groupVals: (()=>{ const arr = (x.groupVals && x.groupVals.length===count ? [...x.groupVals] : Array(count).fill(0)); arr[i]=Number(n)||0; return arr })() } : x))} />
                              </div>
                            ) : (
                              <LightButton key={i} size="sm" color="red" on={!!g[i]} onChange={(next)=> setGs(hostId, row.addr, getGs(hostId, row.addr).map(x=> x.id===r.id ? { ...x, group: (()=>{ const arr = (x.group && x.group.length===count ? [...x.group] : Array(count).fill(false)); arr[i]=next; return arr })() } : x))} />
                            )
                          ))}
                        </div>
                      )
                    } },
                    { key:'sceneLights', title:'場景燈號', width:320, render:(_v:any, r:GroupSceneItem)=> {
                      const isDim = row.type === 'SL-1-10V4CHDIM'
                      const count = isDim ? 4 : 8
                      const ensure = (it: GroupSceneItem) => {
                        const s = (it.scene && it.scene.length===count) ? it.scene : Array(count).fill(false)
                        const sv = isDim ? ((it.sceneVals && it.sceneVals.length===count) ? it.sceneVals : Array(count).fill(0)) : undefined
                        return { s, sv }
                      }
                      const { s, sv } = ensure(r)
                      return (
                        <div className={isDim? 'dim-group':'light-group'} style={isDim? undefined : { gridTemplateColumns: `repeat(${count}, minmax(28px, 1fr))` }}>
                          {Array.from({ length: count }).map((_, i) => (
                            isDim ? (
                              <div className="dim-pair" key={i}>
                                <LightButton size="sm" color="yellow" on={!!s[i]} onChange={(next)=> setGs(hostId, row.addr, getGs(hostId, row.addr).map(x=> x.id===r.id ? { ...x, scene: (()=>{ const arr = (x.scene && x.scene.length===count ? [...x.scene] : Array(count).fill(false)); arr[i]=next; return arr })(), sceneVals: (()=>{ const arr = (x.sceneVals && x.sceneVals.length===count ? [...x.sceneVals] : Array(count).fill(0)); return arr })() } : x))} />
                                <NumberInput className="dim-input" size="sm" value={Number(sv?.[i] ?? 0)} min={0} max={255} step={1} onChange={(n)=> setGs(hostId, row.addr, getGs(hostId, row.addr).map(x=> x.id===r.id ? { ...x, sceneVals: (()=>{ const arr = (x.sceneVals && x.sceneVals.length===count ? [...x.sceneVals] : Array(count).fill(0)); arr[i]=Number(n)||0; return arr })() } : x))} />
                              </div>
                            ) : (
                              <LightButton key={i} size="sm" color="yellow" on={!!s[i]} onChange={(next)=> setGs(hostId, row.addr, getGs(hostId, row.addr).map(x=> x.id===r.id ? { ...x, scene: (()=>{ const arr = (x.scene && x.scene.length===count ? [...x.scene] : Array(count).fill(false)); arr[i]=next; return arr })() } : x))} />
                            )
                          ))}
                        </div>
                      )
                    } },
                  ] as any)}
                  data={getGs(hostId, row.addr) as any}
                  rowKey={(r:GroupSceneItem)=>r.id}
                  renderActions={(r:GroupSceneItem)=> (
                    <div className="row" style={{ gap:6 }}>
                      <SceneAssign
                        hostId={hostId}
                        unitId={row.addr}
                        rows={getGs(hostId, row.addr)}
                        targetIndex={r.index}
                        mapping={sceneGroupMap[`${hostId}-${row.addr}`] || {}}
                        onChange={(next)=> setSceneGroupMap(prev=> ({ ...prev, [`${hostId}-${row.addr}`]: next }))}
                      />
                      <button className="icon-btn" title="刪除" onClick={()=> setGs(hostId, row.addr, getGs(hostId, row.addr).filter(x=> x.id!==r.id))}><IconTrash /></button>
                    </div>
                  )}
                />
              </div>
            )
          }}
        />
        {/* 批量新增群組/場景（從機專用） */}
        <BatchAddGroupSceneModal
          stateKey={batchGs}
          onClose={()=> setBatchGs(null)}
          onSubmit={(hid, unit, s, e, st)=> addGsBatch(hid, unit, s, e, st)}
        />
      </div>
    </div>
  )
}

// 批量新增群組/場景（狀態頁：從機子表格用）
function BatchAddGroupSceneModal({ stateKey, onClose, onSubmit }:{ stateKey: { hostId: string; unitId: number } | null; onClose: ()=>void; onSubmit: (hostId: string, unitId: number, start: number, end: number, step: number)=>void }) {
  const [start, setStart] = useState<number>(1)
  const [end, setEnd] = useState<number>(1)
  const [step, setStep] = useState<number>(1)
  const can = !!stateKey && start>=1 && end>=1 && step>=1
  return (
    <Modal isOpen={!!stateKey} onClose={onClose} title="批量新增群組/場景" maxWidth={520}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="col" style={{ width: 150 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>編號起</div>
            <NumberInput value={start} min={1} max={255} step={1} onChange={(v)=> setStart(Number(v))} />
          </div>
          <div className="col" style={{ width: 150 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>編號迄</div>
            <NumberInput value={end} min={1} max={255} step={1} onChange={(v)=> setEnd(Number(v))} />
          </div>
          <div className="col" style={{ width: 150 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>累加間隔</div>
            <NumberInput value={step} min={1} max={255} step={1} onChange={(v)=> setStep(Number(v))} />
          </div>
        </div>
        <div className="row" style={{ justifyContent:'flex-end', gap:8 }}>
          <Button className="btn--outline" onClick={onClose}>關閉</Button>
          <Button disabled={!can} onClick={()=>{ if (!stateKey) return; onSubmit(stateKey.hostId, stateKey.unitId, start, end, step); onClose() }}>新增</Button>
        </div>
      </div>
    </Modal>
  )
}

// 場景指派多選（沿用 Sites 頁的樣式與互動）
function SceneAssign({ hostId, unitId, rows, targetIndex, mapping, onChange }:{ hostId:string; unitId:number; rows: { id:string; index:number }[]; targetIndex:number; mapping: Record<number, number[]>; onChange:(next:Record<number, number[]>)=>void }){
  const [open, setOpen] = useState(false)
  const allIdx = useMemo(()=> rows.map(r=>r.index).sort((a,b)=>a-b), [rows])
  const current = mapping[targetIndex] || []
  const [draft, setDraft] = useState<number[]>(current)
  useEffect(()=>{ if (open) setDraft(current) }, [open])
  const toggle = (idx:number) => setDraft(prev=> prev.includes(idx) ? prev.filter(x=>x!==idx) : [...prev, idx])
  const apply = () => {
    const next: Record<number, number[]> = {}
    for (const [gStr, list] of Object.entries(mapping)) next[Number(gStr)] = list.filter(x=> !draft.includes(x))
    next[targetIndex] = draft.slice().sort((a,b)=>a-b)
    onChange(next)
    setOpen(false)
  }
  return (
    <>
      <button className="icon-btn" title={`指派場景到群組${targetIndex}`} onClick={()=> setOpen(true)}>
        <IconPlus />
      </button>
      <Modal isOpen={open} onClose={()=> setOpen(false)} title={`指派場景給群組 ${targetIndex}`} maxWidth={520}>
        <div className="col" style={{ gap:10 }}>
          <div className="text-muted">選擇要歸屬於此群組的場景（複選）。</div>
          <div className="col" style={{ gap:6, maxHeight: 260, overflowY:'auto' }}>
            {allIdx.map(idx => (
              <label key={idx} className="row" style={{ gap:8, alignItems:'center' }}>
                <input type="checkbox" checked={draft.includes(idx)} onChange={()=> toggle(idx)} />
                <span>場景{idx}</span>
              </label>
            ))}
            {allIdx.length===0 && <div className="text-muted">尚無可選場景</div>}
          </div>
          <div className="row" style={{ justifyContent:'flex-end', gap:8 }}>
            <Button className="btn--outline" onClick={()=> setOpen(false)}>取消</Button>
            <Button onClick={apply}>套用</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

// 批量新增從機 Modal（狀態頁）
function BatchAddSlavesModal({ host, isOpen, onClose, onAdded }: { host: any|null; isOpen: boolean; onClose: () => void; onAdded?: () => Promise<void> | void }) {
  const [startUnit, setStartUnit] = useState<number>(1)
  const [endUnit, setEndUnit] = useState<number>(1)
  const [step, setStep] = useState<number>(1)
  const [namePrefix, setNamePrefix] = useState<string>('從機')
  const [type, setType] = useState<'SL-SW8CH'|'SL-1-10V4CHDIM'>('SL-SW8CH')
  const [enabled, setEnabled] = useState<boolean>(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(()=>{
    if (isOpen && host) {
      const next = Math.max(1, Number(host.unitId||1))
      setStartUnit(next); setEndUnit(next)
    }
  }, [isOpen, host])

  const genUnits = (s:number, e:number, st:number) => { const arr:number[] = []; for(let u=s; u<=e; u+=st) arr.push(u); return arr }

  const onSubmit = async () => {
    setMessage('')
    if (!host) return
    const s = Number(startUnit), e = Number(endUnit), st = Number(step)
    if (s<1 || e<1 || st<1 || s>247 || e>247 || st>247) { setMessage('站號需在 1..247，間隔 1..247'); return }
    if (s>e) { setMessage('起始需小於或等於結束'); return }
    const units = genUnits(s,e,st)
    if (!units.length) { setMessage('沒有可新增的從機'); return }
    setSubmitting(true)
    let ok=0, fail=0
    try {
      const api = await import('@/api/sites/service')
      // 檢查重複
      const existing = new Set(((await api.listSlavesByHostId(host.id))||[]).map((x:any)=>x.unitId))
      for (const u of units) {
        if (existing.has(u)) { fail++; continue }
        const body = { name: `${namePrefix||'從機'}${u}`, unitId: u, type, enabled } as any
        if (type==='SL-SW8CH') { body.swMask = 0 } else { body.dimMask = 0; body.dimValues = [0,0,0,0] }
        try { await api.addSlave(host.id, body); ok++ } catch { fail++ }
      }
      setMessage(`完成：成功 ${ok} 台，失敗 ${fail} 台。`)
      try { await onAdded?.() } catch {}
    } finally { setSubmitting(false) }
  }

  const canSubmit = !!host && startUnit>=1 && endUnit>=1 && step>=1 && !submitting

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`批量新增從機${host?`（${host.name||host.id}）`:''}`} maxWidth={560}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="col" style={{ width: 150 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>站號起</div>
            <NumberInput value={startUnit} min={1} max={247} step={1} onChange={(v)=> setStartUnit(Number(v))} />
          </div>
          <div className="col" style={{ width: 150 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>站號迄</div>
            <NumberInput value={endUnit} min={1} max={247} step={1} onChange={(v)=> setEndUnit(Number(v))} />
          </div>
          <div className="col" style={{ width: 150 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>累加間隔</div>
            <NumberInput value={step} min={1} max={247} step={1} onChange={(v)=> setStep(Number(v))} />
          </div>
        </div>
        <div className="col" style={{ gap: 6 }}>
          <div className="text-muted" style={{ marginBottom: 4 }}>從機前綴</div>
          <Input value={namePrefix} onChange={(e)=> setNamePrefix(e.currentTarget.value)} placeholder="例如 從機" />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="col" style={{ width: 220 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>從機類型</div>
            <Select size="sm" value={type} onChange={(v)=> setType(v as any)} options={[{label:'SL-SW8CH', value:'SL-SW8CH'},{label:'SL-1-10V4CHDIM', value:'SL-1-10V4CHDIM'}]} />
          </div>
          <div className="col" style={{ width: 180 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>是否啟用</div>
            <Select size="sm" value={enabled?'1':'0'} onChange={(v)=> setEnabled(v==='1')} options={[{label:'否', value:'0'},{label:'是', value:'1'}]} />
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems:'center', justifyContent:'space-between' }}>
          <div className="text-muted" style={{ minHeight: 20 }}>{message}</div>
          <div className="row" style={{ gap: 8 }}>
            <Button className="btn--outline" disabled={!canSubmit} onClick={onSubmit}>{submitting ? '新增中…' : '開始新增'}</Button>
            <Button onClick={onClose} disabled={submitting}>關閉</Button>
          </div>
        </div>
        <div className="text-muted" style={{ fontSize: 12 }}>
          規則：以範圍與間隔建立多個從機；名稱依前綴+站號；每筆皆設定類型與是否啟用，DIM 會預設 4 通道 0 值。
        </div>
      </div>
    </Modal>
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
