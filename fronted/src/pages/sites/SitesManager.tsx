import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Button, SmartTable, InlineEditableCell, Select, Modal, NumberInput, Input, TextBlock, LightButton } from '@/components/index'
import { IconTrash, IconPlus, IconLink } from '@/components/icons'
import useHosts from '@/hooks/useHosts'
import { writeOrQueue, sw8MaskAddress, dimMaskAddress, dimValueAddress } from '@/api/modbus'
// Switch to DB-backed endpoints
import * as SitesApi from '@/api/sites/service'
import type { DbSite as Site, DbHost as Host, DbSlave as Slave, DbSiteVersion as SiteVersion } from '@/api/sites/service'
import { useMessages } from '@/contexts/MessagesContext'
import { pollStatuses } from '@/api/status'

function useSites() {
  const [sites, setSites] = useState<Site[]>([])
  // initial load from DB
  useEffect(()=>{ (async()=>{ try { const list = await SitesApi.listSites(); setSites(list) } catch {} })() }, [])
  const reload = async () => { const list = await SitesApi.listSites(); setSites(list) }
  return { sites, setSites, reload }
}

export default function SitesManager(props: { mode?: 'create' } = {}) {
  const nav = useNavigate()
  const params = useParams()
  const { pathname } = useLocation()
  const { sites, setSites, reload } = useSites()
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const floors = useMemo(()=>{
    const s = new Set<string>()
    sites.forEach(site=>site.hosts.forEach(h=>{ if(h.floor) s.add(h.floor!); h.slaves?.forEach(sl=>{ if(sl.floor) s.add(sl.floor!) }) }))
    return Array.from(s)
  },[sites])
  const rooms = useMemo(()=>{
    const s = new Set<string>()
    sites.forEach(site=>site.hosts.forEach(h=>{ if(h.room) s.add(h.room!); h.slaves?.forEach(sl=>{ if(sl.room) s.add(sl.room!) }) }))
    return Array.from(s)
  },[sites])
  const [filterFloor, setFilterFloor] = useState<string>('')
  const [filterRoom, setFilterRoom] = useState<string>('')

  // Handle /sites/new: 顯示二次確認/命名模態框，不再自動建立
  useEffect(()=>{
    if (pathname.endsWith('/new') || props.mode === 'create') {
      const base = '新案場'
      const existing = new Set(sites.map(s=>s.name))
      let name = base
      let i = 1
      while (existing.has(name)) { i += 1; name = `${base} ${i}` }
      setCreateName(name)
      setCreateOpen(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, props.mode])

  const addSite = async (name: string) => {
    const created = await SitesApi.createSite(name)
    await reload()
    setTimeout(()=>nav(`/sites/${created.id}`),0)
  }
  const deleteSite = async (id: string) => { await SitesApi.deleteSite(id); await reload(); setTimeout(()=>nav('/sites'),0) }
  const renameSite = async (id: string, name: string) => { await SitesApi.patchSite(id, { name }); await reload() }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card" style={{ overflow: 'visible', marginBottom: 8 }}>
        <h3 className="m-0">案場管理(開關/亮度)</h3>
        <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
          <span className="text-muted">快速篩選：</span>
          <Select size="sm" value={filterFloor} onChange={v=>setFilterFloor(String(v))} options={[{value:'',label:'全部樓層'}, ...floors.map(f=>({value:f,label:f}))]} />
          <Select size="sm" value={filterRoom} onChange={v=>setFilterRoom(String(v))} options={[{value:'',label:'全部機房'}, ...rooms.map(r=>({value:r,label:r}))]} />
        </div>
      </div>
      {params.id
  ? <SiteCard siteId={params.id} sites={sites} setSites={setSites} filterFloor={filterFloor} filterRoom={filterRoom} onDeleteSite={deleteSite} onRenameSite={renameSite} reload={reload} />
        : <div className="card"><div className="row" style={{alignItems:'center', justifyContent:'space-between'}}><div>
            <h3 className="m-0">請從左側選擇一個案場</h3>
            <div className="text-muted">或點選「新增案場」建立新的案場</div>
          </div>
          <Button className="btn--outline" onClick={()=>nav('/sites/new')}>新增案場</Button>
        </div></div>
      }

      {/* 新增案場二次確認 */}
      <Modal isOpen={createOpen} onClose={()=>{ setCreateOpen(false); if (pathname.endsWith('/new')) nav('/sites') }} title="新增案場">
        <div className="col" style={{ gap: 12 }}>
          <div className="text-muted">請確認是否要建立新的案場，並可修改名稱：</div>
          <Input value={createName} onChange={(e)=> setCreateName(e.currentTarget.value)} />
          <div className="row" style={{ justifyContent:'flex-end', gap: 8 }}>
            <Button className="btn--outline" onClick={()=>{ setCreateOpen(false); if (pathname.endsWith('/new')) nav('/sites') }}>取消</Button>
            <Button onClick={async()=>{ const name = createName.trim() || '新案場'; const created = await SitesApi.createSite(name); await reload(); setCreateOpen(false); setTimeout(()=>nav(`/sites/${created.id}`),0) }}>確認建立</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function SiteCard({ siteId, sites, setSites, filterFloor, filterRoom, onDeleteSite, onRenameSite, reload }:{ siteId:string; sites:Site[]; setSites:(u:(prev:Site[])=>Site[])=>void; filterFloor:string; filterRoom:string; onDeleteSite:(id:string)=>void; onRenameSite:(id:string,name:string)=>void; reload:()=>Promise<void> }){
  const site = sites.find(s=>s.id===siteId)
  if (!site) return <div className="card">找不到案場</div>

  const [autoPoll, setAutoPoll] = useState(false)
  const { hosts: liveHosts, connect, disconnect, refresh } = useHosts({ pollMs: autoPoll ? 2000 : 0 })
  const prevHostConnRef = React.useRef<Map<string, boolean>>(new Map())
  useEffect(()=>{
    // 在 liveHosts 變動時比較連線變更，僅在 autoPoll 開啟時推送摘要
    if (!autoPoll) { prevHostConnRef.current = new Map((liveHosts||[]).map(h=>[h.id, !!h.connected])); return }
    const cur = new Map((liveHosts||[]).map(h=>[h.id, !!h.connected]))
    const prev = prevHostConnRef.current
    let up: string[] = []
    let down: string[] = []
    for (const [id, conn] of cur) {
      const was = prev.get(id)
      if (typeof was === 'boolean' && was !== conn) { (conn ? up : down).push(id) }
    }
    if (up.length || down.length) {
      const sample = [...up.slice(0,2).map(id=>`${id}↑`), ...down.slice(0,2).map(id=>`${id}↓`)].join(', ')
      const extra = Math.max(0, up.length + down.length - 4)
      const tail = extra ? `，另有 ${extra} 台` : ''
      push({ channel: 'web', level: 'info', text: `自動讀取：主機狀態更新 ↑${up.length} ↓${down.length}${sample ? '，變更：'+sample : ''}${tail}` })
    }
    prevHostConnRef.current = cur
  }, [autoPoll, liveHosts])
  const [batchOpen, setBatchOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [info, setInfo] = useState('')
  const { push } = useMessages()

  const isHostConnected = React.useCallback((hostId:string) => {
    const h = (liveHosts || []).find(x=>x.id===hostId)
    return !!h?.connected
  }, [liveHosts])

  // 依樓層/機房篩選主機，並合併 live 狀態
  const filteredHosts = useMemo(() => {
    const byId = new Map<string, { connected?: boolean }>()
    for (const h of (liveHosts || [])) byId.set(h.id, { connected: h.connected })
    const hasFilter = !!filterFloor || !!filterRoom
    return (site.hosts || [])
      .filter(h => {
        if (!hasFilter) return true
        const hostMatch = (!filterFloor || h.floor === filterFloor) && (!filterRoom || h.room === filterRoom)
        if (hostMatch) return true
        // 若從機符合樓層/機房，也要顯示對應主機
        const slaves = h.slaves || []
        return slaves.some(sl => (!filterFloor || sl.floor === filterFloor) && (!filterRoom || sl.room === filterRoom))
    })
    .map(h => ({ ...h, connected: (h as any).connected ?? byId.get(h.id)?.connected }))
  }, [site.hosts, filterFloor, filterRoom, liveHosts])

  // 穩定 Host 欄位定義（避免每次 render 產生新物件形狀）
  const hostColumns = useMemo(() => ([
    { key:'name', title:'主機名稱', sortable: true, className:'mono', render:(v:any, r:Host)=> <InlineEditableCell value={String(v??'')} onCommit={val=>patchHost(r.id,{name:String(val)})} /> },
    { key:'ip', title:'IP', sortable: true, className:'mono', render:(v:any, r:Host)=> (
      <InlineEditableCell
        value={String(v??'192.168.0.100')}
        onCommit={(val)=>{
          const nextIp = String(val)
          // 檢查同案場是否已有相同 IP（排除自身）
          const dup = (site.hosts||[]).some(hh => hh.id !== r.id && String(hh.ip||'') === nextIp)
          if (dup) { try { push({ channel:'web', level:'warning', text:`IP 重複：${nextIp} 已被其他主機使用` }) } catch {} ; return }
          return patchHost(r.id,{ip: nextIp})
        }}
      />
    ) },
    { key:'connected', title:'主機狀態', sortable: true, render:(_v:any, r:Host)=> (
      <span className={`badge ${((r as any).connected ? 'green' : '')}`}>{(r as any).connected ? '已連線' : '未連線'}</span>
    ) },
    { key:'port', title:'Port', sortable: true, className:'mono', render:(v:any, r:Host)=> <InlineEditableCell value={Number(v??502)} type="number" onCommit={val=>patchHost(r.id,{port:Number(val)})} /> },
    { key:'unitId', title:'Unit ID', sortable: true, className:'mono', render:(v:any, r:Host)=> <InlineEditableCell value={Number(v??1)} type="number" onCommit={val=>patchHost(r.id,{unitId:Number(val)})} /> },
    { key:'floor', title:'樓層', sortable: true, render:(v:any, r:Host)=> <InlineEditableCell value={String(v??'')} onCommit={val=>patchHost(r.id,{floor:String(val)})} /> },
    { key:'room', title:'機房', sortable: true, render:(v:any, r:Host)=> <InlineEditableCell value={String(v??'')} onCommit={val=>patchHost(r.id,{room:String(val)})} /> },
    { key:'note', title:'備註', render:(v:any, r:Host)=> <InlineEditableCell value={String((v??'').toString().slice(0,512))} onCommit={val=>patchHost(r.id,{note:String(val).slice(0,512)})} /> },
  ] as any), [site.id, site.hosts, push])

  // Host CRUD via API
  const addHost = async () => {
    const base = '未命名主機'
    const existing = new Set((site.hosts||[]).map(h=>String(h.name||'')))
    let name = base
    let idx = 2
    while (existing.has(name)) { name = `${base} (${idx})`; idx += 1 }
    const body = { name, ip: '192.168.0.100', port: 502, unitId: 1, floor: '1F', room: '機房A', note: '備註' }
    const r = await SitesApi.addHost(site.id, body)
    try { push({ channel: 'web', level: 'success', text: `DB 新增：host ${body.name}`,
      hostId: r.id, target: 'host', db: { table: 'site_sw_hosts', op: 'insert', columns: Object.keys(body as any), values: body, where: `site_id='${site.id}'` } }) } catch {}
    setSites(prev => prev.map(s=> s.id!==site.id ? s : ({ ...s, hosts: [...s.hosts, { id: r.id, slaves: [], ...body }] })))
  }
  const removeHost = async (hid:string) => { await SitesApi.deleteHost(site.id, hid); setSites(prev => prev.map(s=> s.id!==site.id ? s : ({ ...s, hosts: s.hosts.filter(h=>h.id!==hid) }))) }
  const patchHost = async (hid:string, patch:Partial<Host>) => { await SitesApi.patchHost(site.id, hid, patch); try { push({ channel: 'web', level: 'info', text: `DB 更新：host ${hid}`,
    hostId: hid, target: 'host', db: { table: 'site_sw_hosts', op: 'update', columns: Object.keys(patch as any), values: patch, where: `id='${hid}' AND site_id='${site.id}'` } }) } catch {}
    setSites(prev => prev.map(s=> s.id!==site.id ? s : ({ ...s, hosts: s.hosts.map(h=>h.id===hid?{...h, ...patch}:h) }))) }

  // Slave CRUD via API
  const addSlave = async (hid:string) => {
    const h = site.hosts.find(h=>h.id===hid)!; const unit = Math.max(0, ...((h.slaves||[]).map(sl=>sl.unitId)))+1
    const body = { name: `從機${unit}`, unitId: unit, floor:'1F', room:'機房A', note:'備註', type:'SL-SW8CH' as const, enabled:true, swMask:0 }
    const r = await SitesApi.addSlave(hid, body)
    try { push({ channel: 'web', level: 'success', text: `DB 新增：slave ${body.name}`,
      hostId: hid, slaveAddr: body.unitId, target: 'slave', db: { table: 'site_sw_slaves', op: 'insert', columns: Object.keys(body as any), values: body, where: `host_id='${hid}'` } }) } catch {}
    setSites(prev => prev.map(s=> s.id!==site.id ? s : ({ ...s, hosts: s.hosts.map(h=> h.id!==hid ? h : ({ ...h, slaves: [...(h.slaves||[]), { id: r.id, ...body }] })) })))
  }
  const removeSlave = async (hid:string, unitId:number) => {
    const sl = site.hosts.find(h=>h.id===hid)?.slaves?.find(sl=>sl.unitId===unitId)
    if (!sl?.id) return
    await SitesApi.deleteSlave(hid, sl.id)
    try { push({ channel: 'web', level: 'info', text: `DB 刪除：slave #${unitId}`,
      hostId: hid, slaveAddr: unitId, target: 'slave', db: { table: 'site_sw_slaves', op: 'delete', where: `id='${sl.id}' AND host_id='${hid}'` } }) } catch {}
    setSites(prev => prev.map(s=> s.id!==site.id ? s : ({ ...s, hosts: s.hosts.map(h=> h.id!==hid ? h : ({ ...h, slaves: (h.slaves||[]).filter(x=>x.unitId!==unitId) })) })))
  }
  const patchSlave = async (hid:string, unitId:number, patch:Partial<Slave>) => {
    const sl = site.hosts.find(h=>h.id===hid)?.slaves?.find(sl=>sl.unitId===unitId)
    if (!sl?.id) return
    await SitesApi.patchSlave(hid, sl.id, patch)
    try { push({ channel: 'web', level: 'info', text: `DB 更新：slave #${unitId}`,
      hostId: hid, slaveAddr: unitId, target: 'slave', db: { table: 'site_sw_slaves', op: 'update', columns: Object.keys(patch as any), values: patch, where: `id='${sl.id}' AND host_id='${hid}'` } }) } catch {}
    setSites(prev => prev.map(s=> s.id!==site.id ? s : ({
      ...s,
      hosts: s.hosts.map(h => h.id!==hid ? h : ({
        ...h,
        slaves: (h.slaves||[]).map(x => x.unitId===unitId ? { ...x, ...patch } : x)
      }))
    })))
  }

  // 即時控制：開關 / 調光
  const sendSw = async (hostId:string, unitId:number, chIndex:number, turnOn:boolean, curMask:number) => {
    const bit = (1 << chIndex)
    let next = turnOn ? (curMask | bit) : (curMask & (~bit))
    next = Math.max(0, Math.min(255, next))
    const addr = sw8MaskAddress(unitId)
    // 先投遞送出
    try { push({ channel: 'modbusPoll', level: 'info', text: `SW8 寫入：${hostId} #${unitId} @${addr} = ${next}`, hostId, slaveAddr: unitId, action: 'write', ok: undefined, target: 'slave', modbus: { fc: 0x06, address: addr, values: [next] } }) } catch {}
    const ok = await writeOrQueue(hostId, addr, next, () => isHostConnected(hostId))
    // 再投遞結果
  try { push({ channel: 'dbPollMb', level: ok ? 'success' : 'warning', text: `SW8 寫入：${hostId} #${unitId} @${addr} = ${next}`, hostId, slaveAddr: unitId, action: 'write', ok, target: 'slave', modbus: { fc: 0x06, address: addr, values: [next] } }) } catch {}
    setSites(prev => prev.map(s=> s.id!==site.id ? s : ({
      ...s,
      hosts: s.hosts.map(h=> h.id!==hostId ? h : ({
        ...h,
        slaves: (h.slaves||[]).map(sl=> sl.unitId===unitId ? { ...sl, swMask: next } : sl)
      }))
    })))
  }

  // 批量新增群組/場景 Modal 觸發狀態
  const [batchGs, setBatchGs] = useState<{ hostId: string; unitId: number } | null>(null)

  // 三層快速選單狀態：全域 / 主機 / 從機（值為 '': 無，或 '1'..'32'）
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
    // 同步所有主機
    setHostQuick(prev => {
      const next: Record<string, QuickSel> = { ...prev }
      for (const h of site.hosts) {
        const k = groupKey(h.id)
        next[k] = { ...(next[k]||{}), [mode]: value, [other]: clearOther ? '' : (next[k]?.[other]) }
      }
      return next
    })
    // 同步所有從機
    setSlaveQuick(prev => {
      const next: Record<string, QuickSel> = { ...prev }
      for (const h of site.hosts) {
        for (const sl of (h.slaves||[])) {
          const k = slaveKey(h.id, sl.unitId)
          next[k] = { ...(next[k]||{}), [mode]: value, [other]: clearOther ? '' : (next[k]?.[other]) }
        }
      }
      return next
    })
  }
  const onHostQuickChange = (hostId:string, mode:'group'|'scene', value:string) => {
    const other: 'group'|'scene' = mode === 'group' ? 'scene' : 'group'
    const clearOther = value !== ''
    // 設定主機層
    setHostQuick(prev => ({
      ...prev,
      [groupKey(hostId)]: { ...(prev[groupKey(hostId)]||{}), [mode]: value, [other]: clearOther ? '' : (prev[groupKey(hostId)]?.[other]) }
    }))
    // 同步該主機的從機
    setSlaveQuick(prev => {
      const next: Record<string, QuickSel> = { ...prev }
      const h = site.hosts.find(x=>x.id===hostId)
      if (h) for (const sl of (h.slaves||[])) {
        const k = slaveKey(hostId, sl.unitId)
        next[k] = { ...(next[k]||{}), [mode]: value, [other]: clearOther ? '' : (next[k]?.[other]) }
      }
      return next
    })
  }
  const onSlaveQuickChange = (hostId:string, unitId:number, mode:'group'|'scene', value:string) => {
    const other: 'group'|'scene' = mode === 'group' ? 'scene' : 'group'
    const clearOther = value !== ''
    setSlaveQuick(prev => ({
      ...prev,
      [slaveKey(hostId, unitId)]: { ...(prev[slaveKey(hostId, unitId)]||{}), [mode]: value, [other]: clearOther ? '' : (prev[slaveKey(hostId, unitId)]?.[other]) }
    }))
  }

  // 場景→群組對應：每個從機一份 map（key: groupIndex -> number[] of sceneIndex）
  const [sceneGroupMap, setSceneGroupMap] = useState<Record<string, Record<number, number[]>>>({})

  const sendDimOnOff = async (hostId:string, unitId:number, chIndex:number, turnOn:boolean, curMask:number) => {
    const bit = (1 << chIndex)
    let next = turnOn ? (curMask | bit) : (curMask & (~bit))
    next = Math.max(0, Math.min(15, next))
    const addr = dimMaskAddress(unitId)
    // 先投遞送出
    try { push({ channel: 'modbusPoll', level: 'info', text: `DIM 遮罩：${hostId} #${unitId} @${addr} = ${next}`, hostId, slaveAddr: unitId, action: 'write', ok: undefined, target: 'slave', modbus: { fc: 0x06, address: addr, values: [next] } }) } catch {}
    const ok = await writeOrQueue(hostId, addr, next, () => isHostConnected(hostId))
    // 再投遞結果
  try { push({ channel: 'dbPollMb', level: ok ? 'success' : 'warning', text: `DIM 遮罩：${hostId} #${unitId} @${addr} = ${next}`, hostId, slaveAddr: unitId, action: 'write', ok, target: 'slave', modbus: { fc: 0x06, address: addr, values: [next] } }) } catch {}
    setSites(prev => prev.map(s=> s.id!==site.id ? s : ({
      ...s,
      hosts: s.hosts.map(h=> h.id!==hostId ? h : ({
        ...h,
        slaves: (h.slaves||[]).map(sl=> sl.unitId===unitId ? { ...sl, dimMask: next } : sl)
      }))
    })))
  }

  const sendDim = async (hostId:string, unitId:number, chIndex:number, value:number) => {
    const v = Math.max(0, Math.min(255, Math.round(Number(value) || 0)))
    const addr = dimValueAddress(unitId, chIndex)
    // 先投遞送出
    try { push({ channel: 'modbusPoll', level: 'info', text: `DIM 寫入：${hostId} #${unitId} CH${chIndex+1} @${addr} = ${v}`, hostId, slaveAddr: unitId, action: 'write', ok: undefined, target: 'slave', modbus: { fc: 0x06, address: addr, values: [v] } }) } catch {}
    const ok = await writeOrQueue(hostId, addr, v, () => isHostConnected(hostId))
    // 再投遞結果
  try { push({ channel: 'dbPollMb', level: ok ? 'success' : 'warning', text: `DIM 寫入：${hostId} #${unitId} CH${chIndex+1} @${addr} = ${v}`, hostId, slaveAddr: unitId, action: 'write', ok, target: 'slave', modbus: { fc: 0x06, address: addr, values: [v] } }) } catch {}
    setSites(prev => prev.map(s=> s.id!==site.id ? s : ({
      ...s,
      hosts: s.hosts.map(h=> h.id!==hostId ? h : ({
        ...h,
        slaves: (h.slaves||[]).map(sl=> sl.unitId===unitId ? { ...sl, dimValues: (()=>{ const arr = [...(sl.dimValues||[])]; arr[chIndex] = v; return arr })() } : sl)
      }))
    })))
  }

  // 群組場景表資料（每個從機一份）
  type GroupSceneItem = {
    id: string
    index: number
    group?: boolean[]
    scene?: boolean[]
    // 僅 DIM 類型使用：每通道 0..255
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
    const rows: GroupSceneItem[] = [...cur]
    const host = site.hosts.find(h=>h.id===hid)
    const slave = host?.slaves?.find(s=> s.unitId===unit)
    const isDim = slave?.type === 'SL-1-10V4CHDIM'
    const count = isDim ? 4 : 8
    for (let n = start; n <= end; n += step) {
      if (!existing.has(n)) rows.push({
        id: crypto.randomUUID?.() || `${Date.now()}-${n}`,
        index: n,
        group: Array(count).fill(false),
        scene: Array(count).fill(false),
        groupVals: isDim ? Array(count).fill(0) : undefined,
        sceneVals: isDim ? Array(count).fill(0) : undefined,
      })
    }
    setGs(hid, unit, rows.sort((a,b)=>a.index-b.index))
  }

  return (
    <div className="card">
      <div className="row" style={{ gap: 8, alignItems:'center', justifyContent:'space-between' }}>
        <h3 className="m-0">{site.name}</h3>
        <div className="row" style={{ gap: 8, alignItems:'center' }}>
          {/* 全域：群組寸動（含「無」），變更時同步主機與從機 */}
          <GlobalQuickSelectors value={globalQuick} onChange={onGlobalQuickChange} />
          <VersionBadge site={site} setSites={setSites} />
          <Button onClick={addHost}>新增主機</Button>
          <Button onClick={()=> setBatchOpen(true)} className="btn--outline">批量新增主機</Button>
          <Button className="btn--outline" onClick={async()=>{
            push({ channel: 'web', level: 'info', text: '刷新狀態：已送出請求' })
            try {
              await pollStatuses()
              // 於 reload 後由 auto 變更摘要負責推送細節；這裡仍給成功訊息
              push({ channel: 'web', level: 'success', text: '刷新狀態：後端已完成，正在更新畫面…' })
            } catch {
              push({ channel: 'web', level: 'error', text: '刷新狀態：呼叫失敗' })
            }
            try { await reload() } catch {}
          }}>刷新狀態</Button>
          {/* 移除「掃描從機」功能 */}
          <Button className="btn--outline" onClick={()=>{
            setAutoPoll(v=>{
              const next = !v
              push({ channel: 'web', level: 'info', text: next ? '自動讀取狀態：已開啟' : '自動讀取狀態：已關閉' })
              return next
            })
          }}>{autoPoll ? '關閉自動讀取狀態' : '自動讀取狀態'}</Button>
          <Button className="btn--outline" onClick={async()=>{
            let ok = 0, fail = 0
            for (const h of site.hosts) {
              try { await connect({ id: h.id, ip: String(h.ip||''), port: Number(h.port||502), unitId: Number(h.unitId||1) }); ok++ } catch { fail++ }
            }
            setInfo(`全部連線完成：成功 ${ok} 台，失敗 ${fail} 台`); setInfoOpen(true)
            try { await refresh({ silent: true } as any) } catch {}
          }}>全部連線</Button>
          <Button className="btn--ghost" onClick={async()=>{
            let ok = 0, fail = 0
            for (const h of site.hosts) {
              try { await disconnect(h.id); ok++ } catch { fail++ }
            }
            setInfo(`全部斷線完成：成功 ${ok} 台，失敗 ${fail} 台`); setInfoOpen(true)
            try { await refresh({ silent: true } as any) } catch {}
          }}>全部斷線</Button>
          <Button className="btn--ghost" onClick={async()=>{
            const next = prompt('重命名案場：', site.name)
            if (next && next.trim() && next.trim() !== site.name) {
              try { await onRenameSite(site.id, next.trim()) } catch {}
            }
          }}>重命名</Button>
          <Button className="btn--ghost" onClick={async()=>{
            if (!confirm(`確定要刪除此案場「${site.name}」？此動作無法復原。`)) return
            try { await onDeleteSite(site.id) } catch {}
          }}>刪除此案場</Button>
        </div>
      </div>

      <div style={{ paddingTop: 8 }}>
        <SmartTable
          columns={hostColumns as any}
          data={filteredHosts as any}
          rowKey={(h:Host)=>h.id}
          renderActions={(h:Host)=> (
            <div className="row" style={{ gap: 6 }}>
              <button className="icon-btn icon-only" title="連線" onClick={async()=>{ try { await connect({ id: h.id, ip: String(h.ip||''), port: Number(h.port||502), unitId: Number(h.unitId||1) }); setInfo(`已送出連線：${h.name||h.id}`); setInfoOpen(true) } catch {} }}><IconLink /></button>
              <button className="icon-btn icon-only" title="斷線" onClick={async()=>{ try { await disconnect(h.id); setInfo(`已送出斷線：${h.name||h.id}`); setInfoOpen(true) } catch {} }}><IconLink style={{ transform: 'rotate(45deg)', opacity: .85 }} /></button>
              {/* 移除「搜尋從機」圖示按鈕 */}
              <button className="icon-btn icon-only" title="新增從機" onClick={()=>addSlave(h.id)}><IconPlus /></button>
              <button className="icon-btn" title="刪除主機" onClick={()=>removeHost(h.id)}><IconTrash /></button>
              {/* 主機層：群組寸動（含「無」） */}
              <Select
                size="sm"
                placeholder="群組寸動"
                value={(hostQuick[groupKey(h.id)]?.group ?? '') as any}
                onChange={(v)=>onHostQuickChange(h.id, 'group', v)}
                options={[{ label: '無', value: '' }, ...Array.from({length:32}).map((_,i)=>({ label: `群組${i+1}`, value: String(i+1) }))]}
              />
            </div>
          )}
          expandable={{
            expandedRowRender: (h:Host) => (
              <div className="subtable">
                <SmartTable
                  columns={([
                    { key:'name', title:'從機名稱', render:(v:any, r:Slave)=> <InlineEditableCell value={String(v??'')} onCommit={val=>patchSlave(h.id, r.unitId, {name:String(val)})} /> },
                    { key:'unitId', title:'站號', className:'mono', render:(v:any, r:Slave)=> (
                      <InlineEditableCell value={Number(v??1)} type="number" onCommit={async (val)=>{
                        const next = Number(val)
                        if (!Number.isFinite(next) || next<1 || next>247) return
                        // 重複站號檢查（同主機）
                        const dup = (h.slaves||[]).some(x=> x.unitId !== r.unitId && x.unitId === next)
                        if (dup) { push({ channel:'web', level:'warning', text:`站號重複：#${next} 已存在` }); return }
                        try { await SitesApi.patchSlaveByUnit(h.id, r.unitId, { unitId: next }) } catch (e:any) {
                          push({ channel:'web', level:'error', text:`更新站號失敗：${e?.message||e}` }); return
                        }
                        setSites(prev => prev.map(s=> s.id!==site.id ? s : ({
                          ...s,
                          hosts: s.hosts.map(hh=> hh.id!==h.id ? hh : ({
                            ...hh,
                            slaves: (hh.slaves||[]).map(x=> x.unitId===r.unitId ? { ...x, unitId: next } : x)
                          }))
                        })))
                      }} />
                    ) },
                    { key:'type', title:'從機類型', render:(v:any, r:Slave)=> (
                      <Select size="sm" value={String((r as any).type ?? 'SL-SW8CH')} onChange={(val)=>patchSlave(h.id, r.unitId, { type: val as any })} options={[{label:'SL-SW8CH', value:'SL-SW8CH'}, {label:'SL-1-10V4CHDIM', value:'SL-1-10V4CHDIM'}]} />
                    ) },
                    { key:'floor', title:'樓層', render:(v:any, r:Slave)=> <InlineEditableCell value={String(v??'')} onCommit={val=>patchSlave(h.id, r.unitId, {floor:String(val)})} /> },
                    { key:'room', title:'機房', render:(v:any, r:Slave)=> <InlineEditableCell value={String(v??'')} onCommit={val=>patchSlave(h.id, r.unitId, {room:String(val)})} /> },
                    { key:'note', title:'備註', render:(v:any, r:Slave)=> <InlineEditableCell value={String((v??'').toString().slice(0,512))} onCommit={val=>patchSlave(h.id, r.unitId, {note:String(val).slice(0,512)})} /> },
                  ] as any)}
                  data={h.slaves as any}
                  rowKey={(sl:Slave)=>String(sl.unitId)}
                  renderActions={(sl:Slave)=> (
                    <div className="row" style={{ gap: 6 }}>
                      <button className="icon-btn" title="刪除從機" onClick={()=>removeSlave(h.id, sl.unitId)}><IconTrash /></button>
                      {sl.type === 'SL-SW8CH' && (
                        <div className="light-group">
                          {Array.from({length:8}).map((_,i)=>(
                            <button
                              key={i}
                              className={`light-btn sm ${((sl.swMask ?? 0) & (1<<i)) ? 'on' : 'off'}`}
                              title={`CH${i+1}`}
                              onClick={()=>{
                                const isOn = !!((sl.swMask ?? 0) & (1<<i))
                                sendSw(h.id, sl.unitId, i, !isOn, sl.swMask ?? 0)
                              }}
                            >●</button>
                          ))}
                        </div>
                      )}
                      {sl.type === 'SL-1-10V4CHDIM' && (
                        <div className="dim-group">
                          {Array.from({length:4}).map((_,i)=>(
                            <div className="dim-pair" key={i}>
                              <button
                                className={`light-btn sm ${((sl.dimMask ?? 0) & (1<<i)) ? 'on' : 'off'}`}
                                title={`通道 ${i+1}`}
                                onClick={()=>{
                                  const isOn = !!((sl.dimMask ?? 0) & (1<<i))
                                  sendDimOnOff(h.id, sl.unitId, i, !isOn, sl.dimMask ?? 0)
                                }}
                              >●</button>
                              <NumberInput
                                size="sm"
                                value={(sl.dimValues && sl.dimValues[i] !== undefined) ? sl.dimValues[i] : 0}
                                min={0}
                                max={255}
                                onChange={(v:number)=>sendDim(h.id, sl.unitId, i, v)}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      {/* 從機層「群組寸動」下拉已移除（保留主機/全域層級） */}
                    </div>
                  )}
                  expandable={{
                    expandedRowRender: (sl:Slave) => (
                      <div className="subtable">
                        <div className="row" style={{ justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                          <div className="text-muted">群組場景表</div>
                          <Button className="btn--outline" onClick={()=> setBatchGs({ hostId: h.id, unitId: sl.unitId })}>批量新增群組/場景</Button>
                        </div>
                        <SmartTable
                          columns={([
                            { key:'index', title:'編號', width:120, render:(v:any, r:GroupSceneItem)=> (
                              <InlineEditableCell
                                value={Number(v)}
                                type="number"
                                className="mono"
                                onCommit={(n)=> setGs(h.id, sl.unitId, getGs(h.id, sl.unitId).map(x=> x.id===r.id ? { ...x, index: Number(n)||1 } : x).sort((a,b)=>a.index-b.index))}
                              />
                            ) },
                            { key:'groupLights', title:'群組燈號', width:320, render:(_v:any, r:GroupSceneItem)=> {
                              const isDim = sl.type === 'SL-1-10V4CHDIM'
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
                                        <LightButton size="sm" color="red" on={!!g[i]} onChange={(next)=> setGs(h.id, sl.unitId, getGs(h.id, sl.unitId).map(x=> x.id===r.id ? { ...x, group: (()=>{ const arr = (x.group && x.group.length===count ? [...x.group] : Array(count).fill(false)); arr[i]=next; return arr })(), groupVals: (()=>{ const arr = (x.groupVals && x.groupVals.length===count ? [...x.groupVals] : Array(count).fill(0)); return arr })() } : x))} />
                                        <NumberInput className="dim-input" size="sm" value={Number(gv?.[i] ?? 0)} min={0} max={255} step={1} onChange={(n)=> setGs(h.id, sl.unitId, getGs(h.id, sl.unitId).map(x=> x.id===r.id ? { ...x, groupVals: (()=>{ const arr = (x.groupVals && x.groupVals.length===count ? [...x.groupVals] : Array(count).fill(0)); arr[i]=Number(n)||0; return arr })() } : x))} />
                                      </div>
                                    ) : (
                                      <LightButton key={i} size="sm" color="red" on={!!g[i]} onChange={(next)=> setGs(h.id, sl.unitId, getGs(h.id, sl.unitId).map(x=> x.id===r.id ? { ...x, group: (()=>{ const arr = (x.group && x.group.length===count ? [...x.group] : Array(count).fill(false)); arr[i]=next; return arr })() } : x))} />
                                    )
                                  ))}
                                </div>
                              )
                            } },
                            { key:'sceneLights', title:'場景燈號', width:320, render:(_v:any, r:GroupSceneItem)=> {
                              const isDim = sl.type === 'SL-1-10V4CHDIM'
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
                                        <LightButton size="sm" color="yellow" on={!!s[i]} onChange={(next)=> setGs(h.id, sl.unitId, getGs(h.id, sl.unitId).map(x=> x.id===r.id ? { ...x, scene: (()=>{ const arr = (x.scene && x.scene.length===count ? [...x.scene] : Array(count).fill(false)); arr[i]=next; return arr })(), sceneVals: (()=>{ const arr = (x.sceneVals && x.sceneVals.length===count ? [...x.sceneVals] : Array(count).fill(0)); return arr })() } : x))} />
                                        <NumberInput className="dim-input" size="sm" value={Number(sv?.[i] ?? 0)} min={0} max={255} step={1} onChange={(n)=> setGs(h.id, sl.unitId, getGs(h.id, sl.unitId).map(x=> x.id===r.id ? { ...x, sceneVals: (()=>{ const arr = (x.sceneVals && x.sceneVals.length===count ? [...x.sceneVals] : Array(count).fill(0)); arr[i]=Number(n)||0; return arr })() } : x))} />
                                      </div>
                                    ) : (
                                      <LightButton key={i} size="sm" color="yellow" on={!!s[i]} onChange={(next)=> setGs(h.id, sl.unitId, getGs(h.id, sl.unitId).map(x=> x.id===r.id ? { ...x, scene: (()=>{ const arr = (x.scene && x.scene.length===count ? [...x.scene] : Array(count).fill(false)); arr[i]=next; return arr })() } : x))} />
                                    )
                                  ))}
                                </div>
                              )
                            } },
                          ] as any)}
                          data={getGs(h.id, sl.unitId) as any}
                          rowKey={(r:GroupSceneItem)=>r.id}
                          renderActions={(r:GroupSceneItem)=> (
                            <div className="row" style={{ gap:6 }}>
                              {/* 多選：將場景指派到此群組（以 Modal 呈現複選），並保證一個場景僅能對應一個群組 */}
                              <SceneAssign
                                hostId={h.id}
                                unitId={sl.unitId}
                                rows={getGs(h.id, sl.unitId)}
                                targetIndex={r.index}
                                mapping={sceneGroupMap[rid(h.id, sl.unitId)] || {}}
                                onChange={(next)=> setSceneGroupMap(prev=>({ ...prev, [rid(h.id, sl.unitId)]: next }))}
                              />
                              <button className="icon-btn" title="刪除" onClick={()=> setGs(h.id, sl.unitId, getGs(h.id, sl.unitId).filter(x=> x.id!==r.id))}><IconTrash /></button>
                            </div>
                          )}
                        />
                      </div>
                    )
                  }}
                />
              </div>
            )
          }}
        />
      </div>

      {/* 批量新增群組/場景（從機專用） */}
      <BatchAddGroupSceneModal
        stateKey={batchGs}
        onClose={()=> setBatchGs(null)}
        onSubmit={(hostId, unitId, s, e, st)=> addGsBatch(hostId, unitId, s, e, st)}
      />

      <BatchAddSiteHostsModal
        site={site}
        isOpen={batchOpen}
        onClose={()=> setBatchOpen(false)}
        onAdded={reload}
      />
      <Modal isOpen={infoOpen} onClose={()=> setInfoOpen(false)} title="訊息">
        <div className="col" style={{ gap: 12 }}>
          <TextBlock value={info} minHeight={0} />
          <div className="row" style={{ justifyContent:'flex-end' }}>
            <Button className="btn--outline" onClick={()=> setInfoOpen(false)}>關閉</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function VersionBadge({ site, setSites }:{ site: Site; setSites:(u:(prev:Site[])=>Site[])=>void }) {
  const { push } = useMessages()
  const [open, setOpen] = useState(false)
  const [applyAfterImport, setApplyAfterImport] = useState(true)
  const [pruneAfterImport, setPruneAfterImport] = useState(true)
  const [sortBy, setSortBy] = useState<'created'|'version'>('created')
  const [busy, setBusy] = useState('')
  const [confirmOpen, setConfirmOpen] = useState<{ id: string; version: string }|null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  // 分頁載入（重寫）
  const pageSize = 10
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<SiteVersion[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const loadPage = async (p = page) => {
    setLoading(true)
    try {
      const r = await SitesApi.listVersionsPaged(site.id, { limit: pageSize, offset: p * pageSize, sort: (sortBy==='created'?'created_at':'version'), order: (sortBy==='version'?'ASC':'DESC') })
      setRows(r.data || [])
      setTotal(r.total || 0)
    } catch (e) {
      setRows([]); setTotal(0)
    } finally { setLoading(false) }
  }

  useEffect(()=>{ if (open) loadPage(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, sortBy])
  useEffect(()=>{ if (open) loadPage(page); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page])

  const addNewVersion = async () => {
    try {
      const ver = await SitesApi.createVersion(site.id, true)
      // 以最新頁刷新
      setPage(0)
      await loadPage(0)
      setSites(prev => prev.map(s=> s.id!==site.id ? s : ({ ...s, version: ver.version } as any)))
      try { push({ channel: 'web', level: 'success', text: `DB 新增版本：v${ver.version}`,
        db: { table: 'site_sw_versions', op: 'insert', columns: ['version'], values: { version: ver.version }, where: `site_id='${site.id}'` } }) } catch {}
    } catch (e:any) {
      const msg = e?.message || '未知錯誤'
      setErrorMsg(`新增版本失敗：${msg}`)
    }
  }

  // 已移除「升版（徽章）」功能

  const applyVersion = async (vid: string, version: string) => {
    await SitesApi.applyVersion(site.id, vid, true)
    // 套用後更新徽章顯示
    setSites(prev => prev.map(s=> s.id!==site.id ? s : ({ ...s, version } as any)))
    // 不需變更版本清單，但為保險可刷新目前頁
    await loadPage(page)
    try { push({ channel: 'web', level: 'info', text: `DB 覆蓋現用配置：v${version}`,
      db: { table: 'site_sw_version_snapshots', op: 'update', columns: ['payload'], where: `site_id='${site.id}' AND version_id='${vid}'` } }) } catch {}
  }

  const exportJson = async (vid: string) => {
    const payload = await SitesApi.exportVersion(site.id, vid)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${site.name}-versions-${vid}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importJson = (vid: string) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setBusy('import')
      try {
        const text = await file.text()
        const json = JSON.parse(text)
        await SitesApi.importVersion(site.id, vid, json, applyAfterImport, pruneAfterImport)
      } finally { setBusy('') }
    }
    input.click()
  }

  const removeVersion = async (vid: string) => {
    await SitesApi.deleteVersion(site.id, vid)
    // 重新整理當前頁，若刪到空頁，自動往前一頁
    await loadPage(page)
    const maxPage = Math.max(0, Math.ceil((total-1)/pageSize)-1)
    if (page > maxPage) setPage(maxPage)
    try { push({ channel: 'web', level: 'info', text: `DB 刪除版本：${vid}`,
      db: { table: 'site_sw_versions', op: 'delete', where: `id='${vid}' AND site_id='${site.id}'` } }) } catch {}
  }

  return (
    <>
  <span className="badge" style={{ cursor:'pointer' }} title="版本資訊" onClick={()=>setOpen(true)}>v{(site as any).version || ((site as any).versions?.[0]?.version ?? 'N/A')}</span>
      <Modal isOpen={open} onClose={()=>setOpen(false)} title="版本資訊" maxWidth={'min(92vw, 1200px)'}>
        <div className="col" style={{ gap: 12 }}>
          <div className="row" style={{ alignItems:'center', gap:12, justifyContent:'space-between' }}>
            <div className="row" style={{ alignItems:'center', gap:8 }}>
              <span className="text-muted">目前版本：</span>
              <span className="badge">v{(site as any).version || ((site as any).versions?.[0]?.version ?? 'N/A')}</span>
            </div>
            <div className="row" style={{ gap:8, flexWrap:'wrap' }}>
              <Button onClick={addNewVersion}>新增版本（自動遞增）</Button>
              <Button className="btn--outline" onClick={()=>setSortBy(sortBy==='created'?'version':'created')}>{sortBy==='created'?'依版本排序':'依建立時間排序'}</Button>
            </div>
          </div>

          <div className="row" style={{ gap:12, alignItems:'center' }}>
            <label className="row" style={{ gap:6, alignItems:'center' }}>
              <input type="checkbox" checked={applyAfterImport} onChange={e=>setApplyAfterImport(e.target.checked)} />
              <span className="text-muted">匯入後覆蓋現用配置（立即套用）</span>
            </label>
            <label className="row" style={{ gap:6, alignItems:'center' }}>
              <input type="checkbox" checked={pruneAfterImport} onChange={e=>setPruneAfterImport(e.target.checked)} />
              <span className="text-muted">清除未出現在匯入檔案中的舊項目（prune）</span>
            </label>
          </div>

          <div className="smart-table">
            <table>
              <thead>
                <tr>
                  <th>案場名稱</th>
                    <th>版本號</th>
                    <th>版本說明</th>
                  <th>建立時間</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className="text-muted">載入中…</td></tr>
                )}
                {!loading && rows.length===0 && (
                  <tr><td colSpan={5} className="text-muted">尚無版本</td></tr>
                )}
                {rows.map(v => (
                  <tr key={v.id}>
                    <td>{site.name}</td>
                    <td className="mono">{v.version}</td>
                    <td style={{minWidth:240}}>
                      <InlineEditableCell value={String(v.note ?? '')} onCommit={async (val)=>{
                        const note = String(val).slice(0,512)
                        try {
                          await SitesApi.patchVersion(site.id, v.id, { note })
                          setRows(prev => prev.map(x=> x.id===v.id ? { ...x, note } as any : x))
                        } catch {}
                      }} />
                    </td>
                    <td className="mono">{new Date(v.createdAt).toLocaleString()}</td>
                    <td>
                      <div className="row" style={{ gap:6, flexWrap:'wrap' }}>
                        <Button className="btn--outline" onClick={()=> setConfirmOpen({ id: v.id, version: v.version })} disabled={!!busy}>回復版本</Button>
                        <Button className="btn--outline" onClick={async()=>{ try { await SitesApi.overwriteVersion(site.id, v.id) } catch {} }} disabled={!!busy}>更新快照</Button>
                        <Button className="btn--outline" onClick={()=>importJson(v.id)} disabled={!!busy}>匯入</Button>
                        <Button className="btn--outline" onClick={()=>exportJson(v.id)} disabled={!!busy}>匯出</Button>
                        <Button className="btn--ghost" onClick={()=>removeVersion(v.id)} disabled={!!busy}>刪除</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分頁控制 */}
          <div className="row" style={{ justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
            <span className="text-muted">共 {total} 筆，頁面大小 {pageSize}</span>
            <div className="row" style={{ gap:8 }}>
              <Button className="btn--outline" onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}>上一頁</Button>
              <Button className="btn--outline" onClick={()=>setPage(p=> ( (p+1)*pageSize < total ? p+1 : p ))} disabled={(page+1)*pageSize >= total}>下一頁</Button>
            </div>
          </div>

          <div className="row" style={{ justifyContent:'flex-end', gap:8 }}>
            <Button className="btn--outline" onClick={()=>setOpen(false)}>關閉</Button>
          </div>
        </div>
      </Modal>
      {/* 回復版本二次確認 */}
      <Modal isOpen={!!confirmOpen} onClose={()=>setConfirmOpen(null)} title="回復版本確認" maxWidth={520}>
        <div className="col" style={{ gap: 12 }}>
          <TextBlock value={`確定要回復到版本 v${confirmOpen?.version}？這會覆蓋現用配置，但不會刪除任何版本。`} minHeight={0} />
          <div className="row" style={{ justifyContent:'flex-end', gap: 8 }}>
            <Button className="btn--outline" onClick={()=>setConfirmOpen(null)}>取消</Button>
            <Button onClick={async()=>{ const v = confirmOpen!; setConfirmOpen(null); await applyVersion(v.id, v.version) }}>確定回復</Button>
          </div>
        </div>
      </Modal>
      {/* 錯誤訊息 */}
      <Modal isOpen={!!errorMsg} onClose={()=>setErrorMsg('')} title="訊息">
        <div className="col" style={{ gap: 12 }}>
          <TextBlock value={errorMsg} minHeight={0} />
          <div className="row" style={{ justifyContent:'flex-end', gap: 8 }}>
            <Button className="btn--outline" onClick={()=>setErrorMsg('')}>關閉</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

// 批量新增主機（案場專用）
function BatchAddSiteHostsModal({ site, isOpen, onClose, onAdded }: { site: Site; isOpen: boolean; onClose: () => void; onAdded?: () => Promise<void> | void }) {
  const [startIp, setStartIp] = useState('')
  const [endIp, setEndIp] = useState('')
  const [step, setStep] = useState<number>(1)
  const [namePrefix, setNamePrefix] = useState<string>('主機')
  const [port, setPort] = useState<number>(502)
  const [unitId, setUnitId] = useState<number>(1)
  const [floor, setFloor] = useState('')
  const [room, setRoom] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string>('')

  // 預設值：開啟時若未填，提供常用預設
  useEffect(()=>{
    if (isOpen) {
      setFloor(v => v || '1F')
      setRoom(v => v || '機房A')
      setNote(v => v || '備註')
    }
  }, [isOpen])

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
    const list: { name: string; ip: string; port: number; unitId: number; floor?: string; room?: string; note?: string }[] = []
    const s = info.start
    const e = info.end
    for (let last = s; last <= e; last += stepVal) {
      const prefix = (namePrefix || '主機').trim()
      const name = `${prefix}${last}`
      const ip = `${info.prefix}.${last}`
      list.push({ name, ip, port, unitId, floor: floor || undefined, room: room || undefined, note: note || undefined })
    }
    return list
  }

  const onSubmit = async () => {
    setMessage('')
    const sv = Number(step)
    if (!Number.isFinite(sv) || sv <= 0 || sv > 255) { setMessage('累加間隔需為 1..255 的整數。'); return }
    const parsed = parseIpRange(startIp, endIp)
    if (!parsed.ok) { setMessage(parsed.reason); return }
    const tasks = genTasks(parsed.info, sv)
    if (tasks.length === 0) { setMessage('沒有可新增的主機。'); return }
    setSubmitting(true)
    let ok = 0, fail = 0
    try {
      for (const t of tasks) {
        try {
          const r = await SitesApi.addHost(site.id, t)
          ok++
          // 立即反映到畫面
          // 注意：slaves 預設為空陣列，connected/lastSeen 由後端決定
          // 僅在目前頁簽以本地狀態合併，正式資料以 reload() 為準
        } catch { fail++ }
      }
      setMessage(`完成：成功 ${ok} 台，失敗 ${fail} 台。`)
      try { await onAdded?.() } catch {}
    } finally { setSubmitting(false) }
  }

  const canSubmit = !!startIp && !!endIp && step >= 1 && !submitting

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="批量新增主機" maxWidth={720}>
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
        <div className="row" style={{ gap: 12 }}>
          <div className="col" style={{ width: 150 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>累加間隔</div>
            <NumberInput value={step} min={1} max={255} step={1} onChange={(v)=> setStep(Number(v))} />
          </div>
          <div className="col" style={{ width: 150 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>Port</div>
            <NumberInput value={port} min={1} max={65535} step={1} onChange={(v)=> setPort(Number(v))} />
          </div>
          <div className="col" style={{ width: 150 }}>
            <div className="text-muted" style={{ marginBottom: 4 }}>Unit ID</div>
            <NumberInput value={unitId} min={1} max={247} step={1} onChange={(v)=> setUnitId(Number(v))} />
          </div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="col"><div className="text-muted" style={{ marginBottom: 4 }}>樓層（選填）</div><Input value={floor} onChange={(e)=> setFloor(e.currentTarget.value)} placeholder="例如 1F" /></div>
          <div className="col"><div className="text-muted" style={{ marginBottom: 4 }}>機房（選填）</div><Input value={room} onChange={(e)=> setRoom(e.currentTarget.value)} placeholder="例如 機房A" /></div>
        </div>
        <div className="col">
          <div className="text-muted" style={{ marginBottom: 4 }}>備註（選填）</div>
          <Input value={note} onChange={(e)=> setNote(e.currentTarget.value)} placeholder="最多 512 字" />
        </div>
        <div className="row" style={{ gap: 8, alignItems:'center', justifyContent:'space-between' }}>
          <div className="text-muted" style={{ minHeight: 20 }}>{message}</div>
          <div className="row" style={{ gap: 8 }}>
            <Button className="btn--outline" disabled={!canSubmit} onClick={onSubmit}>{submitting ? '新增中…' : '開始新增'}</Button>
            <Button onClick={onClose} disabled={submitting}>關閉</Button>
          </div>
        </div>
        <div className="text-muted" style={{ fontSize: 12 }}>
          規則：僅變動最後一段 IP；主機名稱依「名稱前綴+最後一段」自動產生（可於清單中再行修改）。預設 Port=502，Unit ID=1，可選填樓層/機房/備註。
        </div>
      </div>
    </Modal>
  )
}

function DimValueInput({ hostId, unit, ch, onSend }:{ hostId:string; unit:number; ch:number; onSend:(val:number)=>void }) {
  const [val, setVal] = useState<number>(0)
  return (
    <NumberInput
      size="sm"
      value={val}
      min={0}
      max={255}
      onChange={(n:number)=>{ const v = Number.isNaN(n) ? 0 : Math.max(0, Math.min(255, Math.round(n))); setVal(v); onSend(v) }}
    />
  )
}

// 批量新增群組/場景（從機子表格用）
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

// ===== 內部狀態與元件：三層（全域/主機/從機）快速選單 + 場景指派 =====
// 全域快速選單（受控）
function GlobalQuickSelectors({ value, onChange }:{ value: { group?: string; scene?: string }; onChange: (mode:'group'|'scene', value:string)=>void }){
  const groupOptions = [{ label: '無', value: '' }, ...Array.from({length:32}).map((_,i)=>({ label: `群組${i+1}`, value: String(i+1) }))]
  return (
    <div className="row" style={{ gap:8, alignItems:'center' }}>
      <Select size="sm" placeholder="群組寸動" value={(value.group ?? '') as any} onChange={(v)=> onChange('group', v)} options={groupOptions} />
    </div>
  )
}

// 將場景指派到特定群組（同一從機內唯一）：以現有 Modal 呈現複選，不新增組件
function SceneAssign({ hostId, unitId, rows, targetIndex, mapping, onChange }:{ hostId:string; unitId:number; rows: { id:string; index:number }[]; targetIndex:number; mapping: Record<number, number[]>; onChange:(next:Record<number, number[]>)=>void }){
  const [open, setOpen] = useState(false)
  const allIdx = useMemo(()=> rows.map(r=>r.index).sort((a,b)=>a-b), [rows])
  const current = mapping[targetIndex] || []
  const [draft, setDraft] = useState<number[]>(current)
  useEffect(()=>{ if (open) setDraft(current) }, [open])
  const toggle = (idx:number) => setDraft(prev=> prev.includes(idx) ? prev.filter(x=>x!==idx) : [...prev, idx])
  const apply = () => {
    // 確保唯一性：同一場景只能屬於一個群組
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
 
