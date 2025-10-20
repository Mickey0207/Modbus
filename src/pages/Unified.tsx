import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, Input, Button, Select, Table, Space, Tag, Typography, Row, Col, InputNumber, Checkbox, Slider, Modal, message, Tooltip, Switch, Drawer } from 'antd'
import { PlusOutlined, DeleteOutlined, SaveOutlined, FolderOpenOutlined, ApiOutlined, BulbFilled, SettingOutlined, EditOutlined, CheckOutlined } from '@ant-design/icons'

const { TextArea } = Input
const { Title, Text } = Typography

// ===== Utilities =====
function numToBytes(num: number, bytes: number) { const arr:number[]=[]; for(let i=bytes-1;i>=0;i--) arr.push((num>>(i*8))&0xff); return arr }
function toHex(bs: number[]) { return bs.map(b=>b.toString(16).padStart(2,'0')).join('') }
function toHexSp(bs: number[]) { return bs.map(b=>b.toString(16).padStart(2,'0')).join(' ') }
function spaced(hex: string) { return hex?.match(/.{1,2}/g)?.join(' ') || '' }
function clamp(n:number,lo:number,hi:number){ return Math.max(lo, Math.min(hi,n)) }

// CRC-8 for custom 485
type CRCParams = { poly:number; init:number; refin:boolean; refout:boolean; xorout:number }
const CRC8_CUSTOM: CRCParams = { poly:0x31, init:0xff, refin:false, refout:false, xorout:0x00 } // Derived from provided samples
const CRC_PARAMS = CRC8_CUSTOM
function reflect8(b:number){ let out=0; for(let i=0;i<8;i++) out=(out<<1)|((b>>i)&1); return out&0xff }
function crc8(bytes:number[], p:CRCParams){ let crc=p.init&0xff; for(let _b of bytes){ let b=_b; if(p.refin) b=reflect8(b); crc^=b; for(let i=0;i<8;i++) crc=(crc&0x80)?((crc<<1)^p.poly)&0xff: (crc<<1)&0xff } if(p.refout) crc=reflect8(crc); return (crc^p.xorout)&0xff }

// ===== Types =====
interface SlaveEntry { unitId:number; typeValue:number|null; name?:string; pending?:boolean; lastRead?:string; lastWrite?:string; error?:string }
interface HostEntry { id:string; name:string; host:string; port:number; tid:number; slaves:SlaveEntry[] }
type ConnState = 'idle'|'ok'|'fail'|'connecting'

export default function Unified(){
  // Hosts & selection
  const [hosts, setHosts] = useState<HostEntry[]>([])
  const [connMap, setConnMap] = useState<Record<string, ConnState>>({})
  const [selectedHostId, setSelectedHostId] = useState<string>('')
  const [selectedUnitId, setSelectedUnitId] = useState<number|null>(null)
  // Hosts Drawer
  const [hostsDrawerOpen, setHostsDrawerOpen] = useState<boolean>(false)
  // 日誌改由 App Header 的跑馬燈處理

  const [hostNameInput, setHostNameInput] = useState('')
  const [hostAddrInput, setHostAddrInput] = useState('127.0.0.1')
  const [hostPortInput, setHostPortInput] = useState(502)

  const emitLog = (tag:string, tx:string, rx:string) => {
    try { window.dispatchEvent(new CustomEvent('modbus:log', { detail: { tag, tx, rx, t: Date.now() } })) } catch {}
  }

  const curHost = useMemo(()=> hosts.find(h=>h.id===selectedHostId) || null,[hosts, selectedHostId])
  const curSlave = useMemo(()=> curHost?.slaves.find(s=>s.unitId===selectedUnitId!) || null,[curHost, selectedUnitId])
  const isWritingRef = useRef(false)
  const autoPollingRef = useRef<{active: boolean; timerId: number}>({active: false, timerId: 0})
  // 切換主機時 UI 鎖定（反白並禁止操作）
  const [uiLocked, setUiLocked] = useState(false)
  const uiLockTimerRef = useRef<number|undefined>(undefined)
  function lockUiFor(ms=5000){
    setUiLocked(true)
    if(uiLockTimerRef.current){ window.clearTimeout(uiLockTimerRef.current) }
    uiLockTimerRef.current = window.setTimeout(()=> setUiLocked(false), ms)
  }
  function showHostSwitchNotice(){
    message.loading({ content: '主機更換中，請勿做任何操作…', key: 'host-switch', duration: 5 })
    lockUiFor(5000)
  }
  // 並行輪詢開關（每主機內，對不同從機各走一條通道）
  const [parallelPolling, setParallelPolling] = useState(false)
  const parallelPollingRef = useRef(parallelPolling)
  useEffect(()=>{ parallelPollingRef.current = parallelPolling }, [parallelPolling])
  const [chNamesByUnit, setChNamesByUnit] = useState<Record<number, string[]>>({})
  const getChNames = (unit:number)=> chNamesByUnit[unit] || (curSlave?.typeValue===1 ? ['CH1','CH2','CH3','CH4','CH5','CH6','CH7','CH8'] : ['CH1','CH2','CH3','CH4'])
  const [syncing, setSyncing] = useState(false)
  const [autoPolling, setAutoPolling] = useState(false)
  // 最新 hosts/連線狀態快取，避免輪詢閉包拿到舊值
  const hostsRef = useRef(hosts)
  const connMapRef = useRef(connMap)
  useEffect(()=>{ hostsRef.current = hosts }, [hosts])
  useEffect(()=>{ connMapRef.current = connMap }, [connMap])
  // 全域儲存各主機/站號的燈號遮罩與 4CH 亮度（供從機清單顯示與多機輪詢）
  const keyOf = (hostId:string, unit:number)=> `${hostId}:${unit}`
  const [maskByKey, setMaskByKey] = useState<Record<string, number>>({})
  const [bright4ByKey, setBright4ByKey] = useState<Record<string, number[]>>({})

  // ===== Quick Switch (群組/場景，依規格位址直寫) =====
  // 25400..25431 對應群組 1..32（寫 1 開、0 關）
  // 24100..24147 場景 1..48 對應群組號（寫入群組編號）
  // 20000 + (group-1)*48 + (scene-1) 寫 1 觸發該群組的該場景
  const [quickGroupSel, setQuickGroupSel] = useState<number|undefined>(undefined)
  const [quickSceneSel, setQuickSceneSel] = useState<number|null>(null)
  const [quickGroupOn, setQuickGroupOn] = useState<boolean>(false)
  // 觸發全部主機開關
  const [triggerAllHosts, setTriggerAllHosts] = useState<boolean>(false)
  // 每台主機的場景→群組對應（長度 48；0 表未設定）
  const [mappingByHost, setMappingByHost] = useState<Record<string, number[]>>({})
  const [mappingNamesByHost, setMappingNamesByHost] = useState<Record<string, string[]>>({})
  const [mappingBaseByHost, setMappingBaseByHost] = useState<Record<string, number[]>>({})
  // 每台主機的群組名稱（1..32），供 UI 顯示；僅本地保存
  const [groupNamesByHost, setGroupNamesByHost] = useState<Record<string, string[]>>({})
  // Mapping table modal state
  type MappingRow = { key:string; scene:number; group:number; name:string; editing?:boolean }
  const [mapModalHostId, setMapModalHostId] = useState<string|undefined>(undefined)
  const [mapRows, setMapRows] = useState<MappingRow[]>([])

  function openMapModal(h:HostEntry){
    const groups = mappingByHost[h.id] || []
    const base = groups.length? groups.slice() : Array(48).fill(0)
    const names = mappingNamesByHost[h.id] || []
    const rows:MappingRow[] = []
    for(let i=0;i<48;i++){
      const g = groups[i] || 0
      if(g>0){ rows.push({ key:`${i+1}`, scene:i+1, group:g, name:names[i]||'', editing:false }) }
    }
    setMapRows(rows)
    setMapModalHostId(h.id)
    setMappingBaseByHost(prev=> ({ ...prev, [h.id]: base }))
  }
  function closeMapModal(){ setMapModalHostId(undefined); setMapRows([]) }
  function usedScenesSet(rows:MappingRow[]){ return new Set(rows.map(r=> r.scene)) }
  function addMapRow(){
    if(mapRows.length>=48){ message.info('已達 48 筆上限'); return }
    const used = usedScenesSet(mapRows)
    let next = 1; while(used.has(next) && next<=48) next++
    if(next>48){ message.info('沒有可用的場景編號'); return }
    setMapRows(prev=> [...prev, { key:`new-${Date.now()}`, scene: next, group: 1, name:'', editing:true }])
  }
  function updateMapRow(key:string, patch:Partial<MappingRow>){ setMapRows(prev=> prev.map(r=> r.key===key? { ...r, ...patch }: r)) }
  function deleteMapRow(key:string){ setMapRows(prev=> prev.filter(r=> r.key!==key)) }

  function getTargetHosts(): HostEntry[]{
    const connected = hosts.filter(h=> connMap[h.id]==='ok')
    if(triggerAllHosts) return connected
    if(selectedHostId){ return connected.filter(h=> h.id===selectedHostId) }
    return []
  }

  function ensureTarget(){
    const th = getTargetHosts()
    if(th.length===0){ 
      if(triggerAllHosts){
        message.info('沒有已連線的主機')
      } else {
        message.info('請先選擇主機（且需為已連線狀態）')
      }
      return false 
    }
    return true
  }

  async function quickOpenGroup(){
    if(!quickGroupSel){ message.warning('請先選擇群組'); return }
    if(!ensureTarget()) return
    const targets = getTargetHosts()
    const group = quickGroupSel
    const addr = 25400 + (group-1)
    await Promise.allSettled(targets.map(async (h)=>{
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const pkt = buildFC06(tid, 1, addr, 1, true)
      try{ const data = await sendHex(h, pkt); emitLog('GROUP-ON', toHexSp(pkt), spaced(data)) }
      catch(e:any){ message.error(`${h.name} 群組 ${group} 觸發失敗: ${e?.message||'error'}`) }
    }))
    message.success(`群組 ${group} 已觸發（${targets.length} 台主機）`)
  }

  async function quickSetGroup(on:boolean){
    if(!quickGroupSel){ message.warning('請先選擇群組'); return }
    if(!ensureTarget()) return
    const targets = getTargetHosts()
    const group = quickGroupSel
    const addr = 25400 + (group-1)
    const val = on? 1: 0
    await Promise.allSettled(targets.map(async (h)=>{
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const pkt = buildFC06(tid, 1, addr, val, true)
      try{ const data = await sendHex(h, pkt); emitLog(on? 'GROUP-ON' : 'GROUP-OFF', toHexSp(pkt), spaced(data)) }
      catch(e:any){ message.error(`${h.name} 群組 ${group} ${on?'開啟':'關閉'}失敗: ${e?.message||'error'}`) }
    }))
    message.success(`群組 ${group} 已${on?'開啟':'關閉'}（${targets.length} 台主機）`)
  }

  function computeSceneOptions(){
    const targets = getTargetHosts()
  const opts: any[] = [{ value: null, label: '無' }]
    const sceneOpts = Array.from({length:48}, (_,i)=>{
      const scene = i+1
      // 若任一主機未設定對應，則禁用
      const anyMissing = targets.some(h=> {
        const map = mappingByHost[h.id]
        const g = map?.[i] ?? 0
        return !(g>=1 && g<=32)
      })
      return { value: scene, label: anyMissing? `場景 ${scene}（沒有設定對應）` : `場景 ${scene}`, disabled: anyMissing }
    })
    return opts.concat(sceneOpts)
  }

  async function quickOpenScene(sceneOverride?: number | null){
    const scene = sceneOverride ?? quickSceneSel
    if(scene==null){ /* 無：不觸發任何場景 */ return }
    if(!ensureTarget()) return
    const targets = getTargetHosts()
    await Promise.allSettled(targets.map(async (h)=>{
      const map = mappingByHost[h.id] || []
      const group = map[scene-1] || 0
      if(!(group>=1 && group<=32)){ message.error(`${h.name} 尚未設定場景 ${scene} 對應群組`); return }
      const block = Math.floor((scene-1)/8)
      const bit = (scene-1) % 8
      const addr = 20000 + (group-1)*48 + block*8
      const val = 1 << bit
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const pkt = buildFC06(tid, 1, addr, val, true)
      try{ const data = await sendHex(h, pkt); emitLog('SCENE-ON', toHexSp(pkt), spaced(data)) }
      catch(e:any){ message.error(`${h.name} 場景 ${scene} 觸發失敗: ${e?.message||'error'}`) }
    }))
    message.success(`場景 ${scene} 已觸發（${targets.length} 台主機）`)
  }

  async function quickSetScene(on:boolean, sceneOverride?: number | null){
    const scene = sceneOverride ?? quickSceneSel
    if(scene==null){ /* 無：不觸發任何場景 */ return }
    if(!ensureTarget()) return
    const targets = getTargetHosts()
    await Promise.allSettled(targets.map(async (h)=>{
      const map = mappingByHost[h.id] || []
      const group = map[scene-1] || 0
      if(!(group>=1 && group<=32)){ message.error(`${h.name} 尚未設定場景 ${scene} 對應群組`); return }
      const block = Math.floor((scene-1)/8)
      const bit = (scene-1) % 8
      const addr = 20000 + (group-1)*48 + block*8
      const val = on ? (1 << bit) : 0
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const pkt = buildFC06(tid, 1, addr, val, true)
      try{ const data = await sendHex(h, pkt); emitLog(on?'SCENE-ON':'SCENE-OFF', toHexSp(pkt), spaced(data)) }
      catch(e:any){ message.error(`${h.name} 場景 ${scene} ${on?'開啟':'關閉'}失敗: ${e?.message||'error'}`) }
    }))
    message.success(`場景 ${scene} 已${on?'開啟':'關閉'}（${targets.length} 台主機）`)
    // 關閉時強制關燈（單暫存器遮罩）
    if(!on){ try{ await forceMaskOff() }catch{} }
  }

  async function forceMaskOff(){
    if(!curHost || selectedUnitId==null){ message.info('請先選擇右側的從機'); return }
    // 先樂觀更新 UI 再寫入
    setMaskValue(0)
    setQuickGroupOn(false)
    try{ await writeMask(curHost, selectedUnitId, 0) }catch(e){ /* ignore */ }
  }

  // 面板讀取流程（延遲同步）已移除，統一由左側的讀取/自動輪詢更新全域狀態

  

  function ensureMappingArray(hostId:string){
    setMappingByHost(prev=> prev[hostId]? prev : ({ ...prev, [hostId]: Array(48).fill(0) }))
  }

  function parseFC03Multi(hex:string): number[]|null{
    const clean=hex.replace(/\s+/g,'')
    const bs=(clean.match(/.{1,2}/g)||[]).map(x=>parseInt(x,16))
    if(bs.length<9) return null
    // MBAP(0..6), PDU start at 7
    if(bs[7]!==0x03) return null
    const byteCount = bs[8]
    const data = bs.slice(9, 9+byteCount)
    if(data.length%2!==0) return null
    const out:number[]=[]
    for(let i=0;i<data.length;i+=2){ out.push(((data[i]&0xff)<<8) | (data[i+1]&0xff)) }
    return out
  }

  async function readMapping(h:HostEntry){
    const base = 24100
    const qty = 48
    // 先嘗試一次性讀取 48 筆
    try{
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const pkt = buildFC03(tid, 1, base, qty, true)
      const data = await sendHex(h, pkt)
      emitLog('MAP-R', toHexSp(pkt), spaced(data))
      const vals = parseFC03Multi(data)
      if(vals && vals.length>=48){
        const clipped = vals.slice(0,48).map(v=> (v>=0 && v<=31)? (v+1) : 0) // 0..31 => 群組1..32，其他=>未設定
        setMappingByHost(prev=> ({ ...prev, [h.id]: clipped }))
        setMappingBaseByHost(prev=> ({ ...prev, [h.id]: clipped.slice() }))
        message.success(`${h.name} 對應已讀取（批次）`)
        return clipped
      }
    }catch(e:any){ /* 轉為逐筆讀取 */ }

    // 批次失敗，逐筆讀取 24100..24147
    const out:number[] = Array(48).fill(0)
  for(let i=0;i<48;i++){
      try{
        const addr = base + i
        const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
        const pkt1 = buildFC03(tid, 1, addr, 1, true)
        const data1 = await sendHex(h, pkt1)
        emitLog('MAP-R1', toHexSp(pkt1), spaced(data1))
        const v = parseFC03One(data1)
        out[i] = (v!=null && v>=0 && v<=31)? (v+1) : 0
      }catch{
        out[i] = 0
      }
    }
    setMappingByHost(prev=> ({ ...prev, [h.id]: out }))
    setMappingBaseByHost(prev=> ({ ...prev, [h.id]: out.slice() }))
    message.success(`${h.name} 對應已讀取（逐筆）`)
    return out
  }

  async function writeMappingRows(h:HostEntry, rows:MappingRow[]){
    // 重新組成完整 48 筆配置（1..32 => 群組；0 => 未設定）
    const curr = Array(48).fill(0)
    for(const r of rows){ if(r.scene>=1 && r.scene<=48){ curr[r.scene-1] = clamp(r.group||0, 0, 32) } }
    // 無論是否變更，全部寫入 24100..24147（寫入值為 0-based：0..31；未設定=0）
    for(let i=0;i<48;i++){
      const scene = i+1
      const group = curr[i] // 1..32 or 0
      const code = group>0? (group-1) : 0
      const addr = 24100 + i
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const pkt = buildFC06(tid, 1, addr, code, true)
      try{ const data = await sendHex(h, pkt); emitLog('MAP-W', toHexSp(pkt), spaced(data)) }catch(e:any){ message.error(`${h.name} 場景${scene} 對應寫入失敗: ${e?.message||'error'}`) }
    }
    // 更新本地基準
    setMappingByHost(prev=> ({ ...prev, [h.id]: curr }))
    setMappingBaseByHost(prev=> ({ ...prev, [h.id]: curr.slice() }))
    message.success(`${h.name} 對應已儲存（全部 48 筆已寫入）`)
  }

  // ===== Modbus TCP FC03/FC06 builders =====
  function buildFC06(tid:number, unitId:number, addr:number, value:number, withMbap=true){ const pdu=[0x06, ...numToBytes(addr,2), ...numToBytes(value,2)]; if(!withMbap) return pdu; const len=pdu.length+1; const mbap=[...numToBytes(tid&0xffff,2), 0x00,0x00, ...numToBytes(len,2), unitId&0xff]; return [...mbap, ...pdu] }
  function buildFC03(tid:number, unitId:number, addr:number, qty=1, withMbap=true){ const pdu=[0x03, ...numToBytes(addr,2), ...numToBytes(qty,2)]; if(!withMbap) return pdu; const len=pdu.length+1; const mbap=[...numToBytes(tid&0xffff,2), 0x00,0x00, ...numToBytes(len,2), unitId&0xff]; return [...mbap, ...pdu] }
  function parseFC03One(hex:string){ const clean=hex.replace(/\s+/g,''); if(clean.length<22) return null; const bs=(clean.match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)); if(bs.length>=11 && bs[7]===0x03 && bs[8]===0x02) return (bs[9]<<8)|bs[10]; return null }

  // Send hex via main process
  async function sendHex(host:HostEntry, bytes:number[]){ const hex=toHex(bytes); const r = await window.api?.sendTcpHex?.(host.host, host.port, hex); if(!r?.ok) throw new Error(r?.error || 'send failed'); return r.data || '' }

  // ===== Hosts management =====
  function addHost(){ 
    const host = hostAddrInput.trim() || '127.0.0.1'; 
    const port = hostPortInput || 502; 
    const name = hostNameInput.trim() || host; 
    const id=`${host}:${port}:${Date.now()}`; 
    const entry:HostEntry={ id,name,host,port,tid:1,slaves:[] }; 
    setHosts(h=>[...h, entry]); 
    setSelectedHostId(id);
    setHostNameInput('');
    setHostAddrInput('127.0.0.1');
    setHostPortInput(502);
  }
  function deleteHost(id:string){ setHosts(h=> h.filter(x=>x.id!==id)); if(selectedHostId===id){ setSelectedHostId(''); setSelectedUnitId(null) } }
  function addSlave(h:HostEntry, unit:number, name?:string){ unit=clamp(unit,0,254); setHosts(list=> list.map(x=> x.id===h.id ? { ...x, slaves: x.slaves.some(s=>s.unitId===unit)? x.slaves : [...x.slaves, {unitId:unit, typeValue:null, name: (name||'').trim()||undefined}].sort((a,b)=>a.unitId-b.unitId) } : x)) }
  function deleteSlave(h:HostEntry, unit:number){ setHosts(list=> list.map(x=> x.id===h.id ? { ...x, slaves: x.slaves.filter(s=>s.unitId!==unit) } : x)) }

  // Connect test per host
  async function connectHost(h:HostEntry){ setConnMap(m=>({...m,[h.id]:'connecting'})); try{ const r= await window.api?.connectHost?.(h.host, h.port); setConnMap(m=>({...m,[h.id]: r?.ok?'ok':'fail'})) } catch { setConnMap(m=>({...m,[h.id]:'fail'})) } }

  // ===== Type registration (FC06/FC03 at 12000+unitId) =====
  async function writeType(h:HostEntry, unit:number, val:number){ if(val!==1 && val!==2) throw new Error('類型僅能 1 或 2'); const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
    const addr=12000+unit; const packet=buildFC06(tid, unit, addr, val, true); const data= await sendHex(h, packet); emitLog('WRITE', toHexSp(packet), spaced(data)); setHosts(list=> list.map(x=> x.id===h.id?{...x, slaves:x.slaves.map(s=> s.unitId===unit?{...s, typeValue:val, lastWrite:spaced(toHex(packet)), error:undefined}:s)}:x)) }
  async function readType(h:HostEntry, unit:number){ const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x})); const addr=12000+unit; const packet=buildFC03(tid, unit, addr, 1, true); const data= await sendHex(h, packet); const v=parseFC03One(data); emitLog('READ', toHexSp(packet), spaced(data)); if(v!=null) setHosts(list=> list.map(x=> x.id===h.id?{...x, slaves:x.slaves.map(s=> s.unitId===unit?{...s, typeValue:v, lastRead:spaced(toHex(packet)), error:undefined}:s)}:x)) }

  // ===== Mask register (2000 + 8*unitId), FC06/FC03 qty=1 =====
  const [maskValue, setMaskValue] = useState<number>(0)
  const [brightness4, setBrightness4] = useState<number[]>([0,0,0,0])
  // 4CH 調光位址：5000 + 8*u + chIndex (chIndex=0..3)
  const dimmingAddr = (unit:number, chIndex:number) => 5000 + 8*unit + chIndex
  async function writeDimming(h:HostEntry, unit:number, chIndex:number, value:number){
    isWritingRef.current = true
    const addr = dimmingAddr(unit, chIndex);
    const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
    const packet = buildFC06(tid, unit, addr, clamp(value,0,255), true)
    try{
      const data = await sendHex(h, packet)
      emitLog('DIMM-W', toHexSp(packet), spaced(data))
    }finally{
      isWritingRef.current = false
    }
  }
  async function readDimmingOne(h:HostEntry, unit:number, chIndex:number){
    const addr = dimmingAddr(unit, chIndex)
    const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
    const packet = buildFC03(tid, unit, addr, 1, true)
    const data = await sendHex(h, packet)
    emitLog('DIMM-R1', toHexSp(packet), spaced(data))
    const v = parseFC03One(data)
    const vv = clamp(v ?? 0, 0, 255)
    // 更新選中從機的本地亮度/遮罩，並同步全域 map
    const isSelected = (h.id===selectedHostId && unit===selectedUnitId)
    const k = keyOf(h.id, unit)
    setBright4ByKey(prev=>{
      const oldArr = prev[k]
      const oldVal = oldArr ? (oldArr[chIndex] ?? 0) : 0
      if(oldVal === vv) return prev
      const arr = (oldArr?.slice() || [0,0,0,0])
      arr[chIndex] = vv
      return { ...prev, [k]: arr }
    })
    // 僅同步亮度，不變更遮罩（避免與 readMask 競爭導致顯示錯亂）
    if(isSelected){ setBrightness4(prev => (prev[chIndex]===vv ? prev : prev.map((x,idx)=> idx===chIndex? vv: x))) }
    return vv
  }
  async function readDimmingAll(h:HostEntry, unit:number){
    for(let i=0;i<4;i++){
      const addr = dimmingAddr(unit, i)
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const packet = buildFC03(tid, unit, addr, 1, true)
      const data = await sendHex(h, packet)
      emitLog('DIMM-R', toHexSp(packet), spaced(data))
      const v = clamp(parseFC03One(data) ?? 0, 0, 255)
      const k = keyOf(h.id, unit)
      // 更新全域 brightness map
      setBright4ByKey(prev=>{
        const oldArr = prev[k]
        const oldVal = oldArr ? (oldArr[i] ?? 0) : 0
        if(oldVal === v) return prev
        const arr = (oldArr?.slice() || [0,0,0,0])
        arr[i] = v
        return { ...prev, [k]: arr }
      })
      // 若是目前選擇的從機，僅同步亮度本地 UI 狀態，不調整遮罩
      if(h.id===selectedHostId && unit===selectedUnitId){ setBrightness4(prev => (prev[i]===v ? prev : prev.map((vv,idx)=> idx===i? v: vv))) }
    }
  }
  async function writeMask(h:HostEntry, unit:number, val:number, silent:boolean=false){
    isWritingRef.current = true
    const addr=2000 + 8*unit; const tid=(h.tid+1)&0xffff;
    setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}));
    const packet=buildFC06(tid, unit, addr, clamp(val,0,0xffff), true);
    try{
      const data= await sendHex(h, packet);
      emitLog('MASK-W', toHexSp(packet), spaced(data));
      // 同步本地遮罩值（不再干涉 4CH 亮度狀態）
      const nv = (curSlave?.typeValue===2) ? (val & 0x0f) : (val & 0xff);
      if(!silent){
        setMaskValue(nv)
        // 同步全域 map
        const k = keyOf(h.id, unit)
        setMaskByKey(prev=> ({ ...prev, [k]: nv }))
      }
    }finally{
      isWritingRef.current = false
    }
  }
  
  // 讀取遮罩（位址 2000 + 8*unit），可用 typeOverride 指定型別影響位寬截取
  async function readMask(h:HostEntry, unit:number, typeOverride?:number){
    const addr=2000 + 8*unit; const tid=(h.tid+1)&0xffff;
    setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}));
    const packet=buildFC03(tid, unit, addr, 1, true);
    const data= await sendHex(h, packet);
    const v=parseFC03One(data);
    emitLog('MASK-R', toHexSp(packet), spaced(data));
    if(v!=null){
      const typ = typeOverride ?? curSlave?.typeValue
      const nv = (typ===2) ? (v & 0x0f) : (v & 0xff);
      const k = keyOf(h.id, unit)
      setMaskByKey(prev=> {
        const before = prev[k]
        if(before === nv) return prev
        return { ...prev, [k]: nv }
      })
      // 僅當前選擇的從機才同步到右側面板本地狀態
      if(h.id===selectedHostId && unit===selectedUnitId){
        setMaskValue(prev => (prev===nv ? prev : nv))
      }
    }
  }

  // 當遮罩為 0（全部關燈）時，讓群組的開關也呈現關閉
  useEffect(()=>{
    if((maskValue & 0xff)===0){
      setQuickGroupOn(false)
    }
  }, [maskValue])

  // 當選擇的主機/從機變更時，使用全域快取（maskByKey/bright4ByKey）立即反映到面板，不主動發起讀取
  useEffect(()=>{
    if(!curHost || selectedUnitId==null) return
    const k = keyOf(curHost.id, selectedUnitId)
    const mv = maskByKey[k]
    if(mv!=null){ setMaskValue(curSlave?.typeValue===2? (mv & 0x0f) : (mv & 0xff)) }
    const bv = bright4ByKey[k]
    if(bv){ setBrightness4([bv[0]||0,bv[1]||0,bv[2]||0,bv[3]||0]) }
  }, [curHost?.id, selectedUnitId, curSlave?.typeValue, maskByKey, bright4ByKey])

  // 當選擇的從機類型改變時，自動更新群組/場景操作面板的類型
  useEffect(()=>{
    if(curSlave?.typeValue){
      setSlaveType(curSlave.typeValue as 1|2)
    }
  }, [curSlave?.typeValue])

  // 組件卸載時停止自動輪詢
  useEffect(()=>{
    return () => {
      stopAutoPolling()
      if(uiLockTimerRef.current){ window.clearTimeout(uiLockTimerRef.current) }
    }
  }, [])

  // 依類型執行一次同步：8CH 僅讀遮罩；4CH 讀遮罩 + 讀全部調光
  async function syncByType(h:HostEntry, unit:number, typ:number|null|undefined){
    if(typ==null) return;
    setSyncing(true)
    try{
      await readMask(h, unit, typ)
      if(typ===2){
        await readDimmingAll(h, unit)
      }
    }finally{
      setSyncing(false)
    }
  }

  // 讀取燈號 - 一次讀取所有從機的燈號狀態
  async function readAllLights(){
    if(!curHost) return
    const connected = hosts.filter(h=> connMap[h.id]==='ok')
    setSyncing(true)
    try{
      for(const h of connected){
        for(const s of h.slaves){
          if(s.typeValue) await readMask(h, s.unitId)
        }
      }
    }finally{
      setSyncing(false)
    }
  }

  // 讀取調光值 - 一次讀取所有 4CH 從機的調光值（讀取全部 4 通道）
  async function readAllDimming(){
    if(!curHost) return
    const connected = hosts.filter(h=> connMap[h.id]==='ok')
    setSyncing(true)
    try{
      for(const h of connected){
        for(const s of h.slaves){
          // 讀取 4CH 的全部通道
          if(s.typeValue === 2) await readDimmingAll(h, s.unitId)
        }
      }
    }finally{
      setSyncing(false)
    }
  }

  // 自動輪詢 - 定期讀取所有從機的燈號和調光值
  async function startAutoPolling(){
    if(autoPollingRef.current.active) return
    autoPollingRef.current.active = true
    setAutoPolling(true)

    const pollOnce = async () => {
      if(!autoPollingRef.current.active) return
      const connected = hostsRef.current.filter(h=> connMapRef.current[h.id]==='ok')
      try{
        for(const h of connected){
          if(!autoPollingRef.current.active) break
          const work = h.slaves.map((s)=> async ()=>{
            if(!autoPollingRef.current.active) return
            if(s.typeValue === 1){
              await readMask(h, s.unitId)
            } else if(s.typeValue === 2){
              await Promise.allSettled([
                (async()=>{ await readMask(h, s.unitId) })(),
                (async()=>{ await readDimmingAll(h, s.unitId) })(),
              ])
            }
          })
          if(parallelPollingRef.current){
            // 並行：每個從機一條通道
            await Promise.allSettled(work.map(fn=> fn()))
          }else{
            // 序列化：逐台從機依序
            for(const fn of work){ await fn() }
          }
        }
      }catch(e){
        // 輪詢過程中的錯誤忽略，繼續輪詢
      }

      // 安排下一次輪詢
      if(autoPollingRef.current.active){
        autoPollingRef.current.timerId = window.setTimeout(pollOnce, 1000)
      }
    }

    pollOnce()
  }

  // 停止自動輪詢
  function stopAutoPolling(){
    autoPollingRef.current.active = false
    if(autoPollingRef.current.timerId){
      window.clearTimeout(autoPollingRef.current.timerId)
      autoPollingRef.current.timerId = 0
    }
    setAutoPolling(false)
  }
  // 輪詢已移除：回復為手動讀取（例如按鈕或按燈時讀單通道）

  
  const [slaveType,setSlaveType]=useState<1|2>(1)
  // Scenes/Groups: 表格資料模型（依 Range 與 Type 分開保存）
  type RowBase = { key:string; index:number; name:string; editing?:boolean }
  // SceneRow: 8CH 使用 toggles；4CH 使用 values (0..255)
  type SceneRow = RowBase & { toggles?:boolean[]; values?:number[] }
  type GroupRow = RowBase & { toggles:boolean[] }

  const [sceneRange,setSceneRange]=useState<1|2|3|4>(1)
  const [groupRange,setGroupRange]=useState<1|2>(1)
  // 啟用區段：1..8 與 9..16
  const [sceneEnableLow, setSceneEnableLow] = useState<boolean>(true)
  const [sceneEnableHigh, setSceneEnableHigh] = useState<boolean>(true)
  const [groupEnableLow, setGroupEnableLow] = useState<boolean>(true)
  const [groupEnableHigh, setGroupEnableHigh] = useState<boolean>(true)

  const [sceneRows8ByRange, setSceneRows8ByRange] = useState<Record<1|2|3|4, SceneRow[]>>({1:[],2:[],3:[],4:[]})
  const [sceneRows4ByRange, setSceneRows4ByRange] = useState<Record<1|2|3|4, SceneRow[]>>({1:[],2:[],3:[],4:[]})
  const [groupRows8ByRange, setGroupRows8ByRange] = useState<Record<1|2, GroupRow[]>>({1:[],2:[]})
  const [groupRows4ByRange, setGroupRows4ByRange] = useState<Record<1|2, GroupRow[]>>({1:[],2:[]})

  // 確保每個 Range 皆有 16 列（自動依類型建立預設列）
  useEffect(()=>{
    if(slaveType===1){
      const rows = sceneRows8ByRange[sceneRange]
      if(!rows?.length){
        const list: SceneRow[] = Array.from({length:16}, (_,i)=> ({ key:`S8-${sceneRange}-${i+1}`, index:i+1, name:'', toggles:Array(8).fill(false) }))
        setSceneRows8ByRange(prev=> ({ ...prev, [sceneRange]: list }))
      }
    }else{
      const rows = sceneRows4ByRange[sceneRange]
      if(!rows?.length){
        const list: SceneRow[] = Array.from({length:16}, (_,i)=> ({ key:`S4-${sceneRange}-${i+1}`, index:i+1, name:'', values:[0,0,0,0] }))
        setSceneRows4ByRange(prev=> ({ ...prev, [sceneRange]: list }))
      }
    }
  }, [slaveType, sceneRange])

  useEffect(()=>{
    if(slaveType===1){
      const rows = groupRows8ByRange[groupRange]
      if(!rows?.length){
        const list: GroupRow[] = Array.from({length:16}, (_,i)=> ({ key:`G8-${groupRange}-${i+1}`, index:i+1, name:'', toggles:Array(8).fill(false) }))
        setGroupRows8ByRange(prev=> ({ ...prev, [groupRange]: list }))
      }
    }else{
      const rows = groupRows4ByRange[groupRange]
      if(!rows?.length){
        const list: GroupRow[] = Array.from({length:16}, (_,i)=> ({ key:`G4-${groupRange}-${i+1}`, index:i+1, name:'', toggles:Array(4).fill(false) }))
        setGroupRows4ByRange(prev=> ({ ...prev, [groupRange]: list }))
      }
    }
  }, [slaveType, groupRange])

  // Helpers: 取得/設定目前 Range 下的 rows
  const getSceneRows = ():SceneRow[] => (slaveType===1? sceneRows8ByRange[sceneRange] : sceneRows4ByRange[sceneRange])
  const setSceneRows = (rows:SceneRow[]) => {
    if(slaveType===1){ setSceneRows8ByRange(prev=> ({...prev, [sceneRange]: rows})) }
    else { setSceneRows4ByRange(prev=> ({...prev, [sceneRange]: rows})) }
  }
  const getGroupRows = ():GroupRow[] => (slaveType===1? groupRows8ByRange[groupRange] : groupRows4ByRange[groupRange])
  const setGroupRows = (rows:GroupRow[]) => {
    if(slaveType===1){ setGroupRows8ByRange(prev=> ({...prev, [groupRange]: rows})) }
    else { setGroupRows4ByRange(prev=> ({...prev, [groupRange]: rows})) }
  }

  // 新增/刪除/更新 列（Scenes/Groups）
  function nextAvailableIndex(rows:RowBase[], max=16){ const used=new Set(rows.map(r=>r.index)); for(let i=1;i<=max;i++){ if(!used.has(i)) return i } return 0 }
  function addSceneRow(){
    const curr=getSceneRows(); if(curr.length>=16){ message.info('已達 16 筆上限'); return }
    const idx=nextAvailableIndex(curr); if(!idx){ message.info('沒有可用的編號'); return }
    const row:SceneRow = slaveType===1
      ? { key:`S-${Date.now()}`, index:idx, name:'', toggles: Array(8).fill(false), editing:false }
      : { key:`S-${Date.now()}`, index:idx, name:'', values: Array(4).fill(0), editing:false }
    setSceneRows([...curr, row])
  }
  function deleteSceneRow(key:string){ const curr=getSceneRows(); setSceneRows(curr.filter(r=> r.key!==key)) }
  function updateSceneRow(key:string, patch:Partial<SceneRow>){ const curr=getSceneRows(); setSceneRows(curr.map(r=> r.key===key? {...r, ...patch}: r)) }
  function toggleSceneRowLight(key:string, ch:number){
    const curr=getSceneRows();
    const needLen = (slaveType===1?8:4)
    setSceneRows(curr.map(r=> {
      if(r.key!==key) return r
      const arr = (r.toggles||[]).slice()
      // pad to needLen
      for(let i=arr.length;i<needLen;i++) arr[i]=false
      arr[ch] = !arr[ch]
      return { ...r, toggles: arr }
    }))
  }

  function setSceneRowValue(key:string, ch:number, value:number){
    const curr=getSceneRows();
    const needLen = 4
    const vv = clamp(Number(value)||0, 0, 255)
    setSceneRows(curr.map(r=>{
      if(r.key!==key) return r
      const arr = (r.values||[]).slice()
      for(let i=arr.length;i<needLen;i++) arr[i]=0
      arr[ch] = vv
      return { ...r, values: arr }
    }))
  }

  function addGroupRow(){ const curr=getGroupRows(); if(curr.length>=16){ message.info('已達 16 筆上限'); return } const idx=nextAvailableIndex(curr); if(!idx){ message.info('沒有可用的編號'); return } const toggles=Array(slaveType===1?8:4).fill(false) as boolean[]; const row:GroupRow={ key:`G-${Date.now()}`, index:idx, name:'', toggles, editing:false }; setGroupRows([...curr, row]) }
  function deleteGroupRow(key:string){ const curr=getGroupRows(); setGroupRows(curr.filter(r=> r.key!==key)) }
  function updateGroupRow(key:string, patch:Partial<GroupRow>){ const curr=getGroupRows(); setGroupRows(curr.map(r=> r.key===key? {...r, ...patch}: r)) }
  function toggleGroupRowLight(key:string, ch:number){
    const curr=getGroupRows();
    const needLen = (slaveType===1?8:4)
    setGroupRows(curr.map(r=> {
      if(r.key!==key) return r
      const arr = r.toggles.slice()
      for(let i=arr.length;i<needLen;i++) arr[i]=false
      arr[ch] = !arr[ch]
      return { ...r, toggles: arr }
    }))
  }

  // 工具：根據 rows 建立 16 筆值與啟用位元（場景）
  function sceneRowsToPayload(rows:SceneRow[]){
    const byIndex: Record<number, SceneRow|undefined> = {}
    for(const r of rows){ byIndex[r.index]=r }
    // enable bits：1..8 -> enLow 的 bit0..bit7；9..16 -> enHigh 的 bit0..bit7
    let enLow=0, enHigh=0
    if(slaveType===1){
      // 8CH：每列 1..16 -> 一個 0..255 bitmask
      const payload:number[] = []
      for(let i=1;i<=16;i++){
        const r = byIndex[i]
        const inLow = i<=8
        const halfEnabled = inLow ? sceneEnableLow : sceneEnableHigh
        if(!halfEnabled){
          payload.push(0)
        }else{
          const toggles = r?.toggles || []
          const mask = toggles.reduce((acc,v,idx)=> acc | (v? (1<<idx):0), 0)
          payload.push(mask & 0xff)
          // 規格：只要該半段啟用，對應列的使能位就必須置 1
          if(inLow){ enLow |= (1<<(i-1)) } else { enHigh |= (1<<(i-9)) }
        }
      }
      return { enLow, enHigh, payload }
    }else{
      // 4CH：每列 -> 4 個 0..255（滑桿值）
      const payload:number[] = []
      for(let i=1;i<=16;i++){
        const r = byIndex[i]
        const inLow = i<=8
        const halfEnabled = inLow ? sceneEnableLow : sceneEnableHigh
        if(!halfEnabled){
          payload.push(0,0,0,0)
        }else{
          const vals = r?.values || [0,0,0,0]
          const arr = [
            clamp(vals[0]||0,0,255),
            clamp(vals[1]||0,0,255),
            clamp(vals[2]||0,0,255),
            clamp(vals[3]||0,0,255),
          ]
          payload.push(...arr.map(v=> v & 0xff))
          // 同上：啟用即置位，不看內容
          if(inLow){ enLow |= (1<<(i-1)) } else { enHigh |= (1<<(i-9)) }
        }
      }
      return { enLow, enHigh, payload }
    }
  }

  function groupRowsToPayload(rows:GroupRow[]){
    const byIndex: Record<number, GroupRow|undefined> = {}
    for(const r of rows){ byIndex[r.index]=r }
    const payload:number[] = []
    if(slaveType===1){
      // 8CH：每列 -> 0..255 bitmask
      for(let i=1;i<=16;i++){
        const inLow = i<=8
        const halfEnabled = inLow ? groupEnableLow : groupEnableHigh
        if(!halfEnabled){ payload.push(0) }
        else {
          const r = byIndex[i]
          const mask = r? r.toggles.reduce((acc,v,idx)=> acc | (v? (1<<idx):0), 0) : 0
          payload.push(mask & 0xff)
        }
      }
    }else{
      // 4CH：每列 -> 0..15 bitmask
      for(let i=1;i<=16;i++){
        const inLow = i<=8
        const halfEnabled = inLow ? groupEnableLow : groupEnableHigh
        if(!halfEnabled){ payload.push(0) }
        else {
          const r = byIndex[i]
          const mask = r? r.toggles.reduce((acc,v,idx)=> acc | (v? (1<<idx):0), 0) : 0
          payload.push(mask & 0x0f)
        }
      }
    }
    return payload
  }

  const sceneWrite = useMemo(()=>{ 
    const h=[clamp(selectedUnitId??0,0,254),0x1a,slaveType,sceneRange]
    const rows = getSceneRows()
    const { enLow, enHigh, payload } = sceneRowsToPayload(rows)
    const en=[enLow & 0xff, enHigh & 0xff]
    const bytes=[...h,...en,...payload]
    const c=crc8(bytes,CRC_PARAMS)
    return [...bytes,c]
  },[selectedUnitId,slaveType,sceneRange,sceneRows8ByRange,sceneRows4ByRange,sceneEnableLow,sceneEnableHigh])

  const groupWrite = useMemo(()=>{ 
    const h=[clamp(selectedUnitId??0,0,254),0x19,slaveType,groupRange]
    const rows = getGroupRows()
    const payload = groupRowsToPayload(rows)
    const bytes=[...h,...payload]
    const c=crc8(bytes,CRC_PARAMS)
    return [...bytes,c]
  },[selectedUnitId,slaveType,groupRange,groupRows8ByRange,groupRows4ByRange,groupEnableLow,groupEnableHigh])

  // 取得顯示用名稱（場景/群組）
  const sceneDisplayName = (sceneNo:number) => {
    const hid = curHost?.id
    if(!hid) return ''
    const arr = mappingNamesByHost[hid] || []
    return arr[sceneNo-1] || ''
  }
  const groupDisplayName = (groupNo:number) => {
    const hid = curHost?.id
    if(!hid) return ''
    const arr = groupNamesByHost[hid] || []
    return arr[groupNo-1] || ''
  }

  // Send 485 packets via TCP transparent host (selected host)
  // 注意：使用 raw 通道，依「閒置時間」判斷回覆完成，不走 MBAP 長度判斷
  async function send485(bytes:number[]){
    if(!curHost) throw new Error('請先選取主機與從機')
    const hex = toHex(bytes)
    const res = await window.api?.sendTcpHexRaw?.(curHost.host, curHost.port, hex, 200, 2000)
    if(!res?.ok){ throw new Error(res?.error || 'send failed') }
    return spaced(res.data||'')
  }

  // Raw 發送功能已移除（依需求）

  // Snapshot import/export (manual, no persistence)
  // version 2: include nearly all settings (except logs/connection/status caches)
  function buildSnapshot(){
    const hostIdx = hosts.findIndex(h=> h.id===selectedHostId)
    const unitIdx = hostIdx>=0 ? (hosts[hostIdx].slaves.findIndex(s=> s.unitId===selectedUnitId!) ) : -1
    return {
      version: 2,
      ui: {
        parallelPolling,
        triggerAllHosts,
        selectedHostIndex: hostIdx,
        selectedUnitIndex: unitIdx,
        slaveType,
        sceneRange,
        groupRange,
        sceneEnableLow,
        sceneEnableHigh,
        groupEnableLow,
        groupEnableHigh,
        quickGroupSel: quickGroupSel ?? null,
        quickSceneSel: quickSceneSel ?? null,
      },
      chNamesByUnit,
      scenes: {
        rows8ByRange: sceneRows8ByRange,
        rows4ByRange: sceneRows4ByRange,
      },
      groups: {
        rows8ByRange: groupRows8ByRange,
        rows4ByRange: groupRows4ByRange,
      },
      hosts: hosts.map(h=>({
        name: h.name,
        host: h.host,
        port: h.port,
        slaves: h.slaves.map(s=>({ unitId: s.unitId, typeValue: s.typeValue ?? null, name: s.name ?? '' })),
        mapping: mappingByHost[h.id] || [],
        mappingNames: mappingNamesByHost[h.id] || [],
        groupNames: groupNamesByHost[h.id] || [],
      }))
    }
  }
  function validateSnap(obj:any){
    if(!obj||typeof obj!=='object') return false
    if(obj.version===1){
      if(!Array.isArray(obj.hosts)) return false
      for(const h of obj.hosts){ if(!h||typeof h!=='object') return false; if(typeof h.name!=='string'||typeof h.host!=='string'||typeof h.port!=='number') return false; if(!Array.isArray(h.slaves)) return false; for(const s of h.slaves){ if(typeof s!=='object'||typeof s.unitId!=='number') return false; if(s.typeValue!=null && typeof s.typeValue!=='number') return false } }
      return true
    }
    if(obj.version===2){
      if(!Array.isArray(obj.hosts)) return false
      // hosts basic
      for(const h of obj.hosts){ if(!h||typeof h!=='object') return false; if(typeof h.name!=='string'||typeof h.host!=='string'||typeof h.port!=='number') return false; if(!Array.isArray(h.slaves)) return false }
      // optional sections are loosely validated
      return true
    }
    return false
  }
  async function exportToFile(){
    try{
      const snap = buildSnapshot();
      const json = JSON.stringify(snap, null, 2);
      const res = await window.api?.saveJson?.(json, 'modbus-snapshot.json');
      if(!res?.ok && !res?.canceled) alert(res?.error||'匯出失敗');
    }catch(e:any){ alert('匯出失敗: '+(e?.message||e)) }
  }
  async function importFromFile(){
    try{
      const res = await window.api?.openJson?.();
      if(!res || res.canceled) return;
      const obj = JSON.parse(res.data || '{}');
      if(!validateSnap(obj)) throw new Error('JSON 結構不符');

      if(obj.version===1){
        // backward compat: rebuild minimal info
        const rebuilt:HostEntry[] = obj.hosts.map((h:any)=>({ id:`${h.host}:${h.port}:${Date.now()}-${Math.random().toString(36).slice(2,8)}`, name:h.name, host:h.host, port:h.port, tid:1, slaves:h.slaves.map((s:any)=>({unitId:s.unitId, typeValue:s.typeValue??null})) }));
        setHosts(rebuilt);
        setSelectedHostId(rebuilt[0]?.id||'');
        setSelectedUnitId(rebuilt[0]?.slaves[0]?.unitId ?? null);
        return
      }

      // v2 full snapshot
      const snap = obj as any
      const now = Date.now()
      const rebuilt:HostEntry[] = snap.hosts.map((h:any, idx:number)=>({
        id: `${h.host}:${h.port}:${now}-${idx}-${Math.random().toString(36).slice(2,6)}`,
        name: h.name,
        host: h.host,
        port: h.port,
        tid: 1,
        slaves: (h.slaves||[]).map((s:any)=>({unitId: s.unitId, typeValue: s.typeValue??null, name: s.name}))
      }))
      setHosts(rebuilt)

      // restore per-host mapping/name data
      const newMapByHost: Record<string, number[]> = {}
      const newMapNamesByHost: Record<string, string[]> = {}
      const newGroupNamesByHost: Record<string, string[]> = {}
      rebuilt.forEach((h, idx)=>{
        const src = snap.hosts[idx] || {}
        newMapByHost[h.id] = Array.isArray(src.mapping)? src.mapping.slice() : []
        newMapNamesByHost[h.id] = Array.isArray(src.mappingNames)? src.mappingNames.slice() : []
        newGroupNamesByHost[h.id] = Array.isArray(src.groupNames)? src.groupNames.slice() : []
      })
      setMappingByHost(newMapByHost)
      setMappingNamesByHost(newMapNamesByHost)
      setGroupNamesByHost(newGroupNamesByHost)

      // restore ch names (global by unit)
      if(snap.chNamesByUnit && typeof snap.chNamesByUnit==='object') setChNamesByUnit(snap.chNamesByUnit)

      // restore scenes/groups rows
      if(snap.scenes?.rows8ByRange) setSceneRows8ByRange(snap.scenes.rows8ByRange)
      if(snap.scenes?.rows4ByRange) setSceneRows4ByRange(snap.scenes.rows4ByRange)
      if(snap.groups?.rows8ByRange) setGroupRows8ByRange(snap.groups.rows8ByRange)
      if(snap.groups?.rows4ByRange) setGroupRows4ByRange(snap.groups.rows4ByRange)

      // restore UI flags
      const ui = snap.ui||{}
      if(typeof ui.parallelPolling==='boolean') setParallelPolling(ui.parallelPolling)
      if(typeof ui.triggerAllHosts==='boolean') setTriggerAllHosts(ui.triggerAllHosts)
      if(typeof ui.slaveType==='number') setSlaveType(ui.slaveType===2?2:1)
      if([1,2,3,4].includes(ui.sceneRange)) setSceneRange(ui.sceneRange)
      if([1,2].includes(ui.groupRange)) setGroupRange(ui.groupRange)
      if(typeof ui.sceneEnableLow==='boolean') setSceneEnableLow(ui.sceneEnableLow)
      if(typeof ui.sceneEnableHigh==='boolean') setSceneEnableHigh(ui.sceneEnableHigh)
      if(typeof ui.groupEnableLow==='boolean') setGroupEnableLow(ui.groupEnableLow)
      if(typeof ui.groupEnableHigh==='boolean') setGroupEnableHigh(ui.groupEnableHigh)
      if(ui.quickSceneSel===null || typeof ui.quickSceneSel==='number') setQuickSceneSel(ui.quickSceneSel ?? null)
      if(ui.quickGroupSel==null || typeof ui.quickGroupSel==='number') setQuickGroupSel(ui.quickGroupSel ?? undefined)

      // selection by indices
      const hIdx = typeof ui.selectedHostIndex==='number' ? ui.selectedHostIndex : 0
      const pickedHost = rebuilt[hIdx] || rebuilt[0]
      setSelectedHostId(pickedHost?.id || '')
      const uIdx = typeof ui.selectedUnitIndex==='number' ? ui.selectedUnitIndex : 0
      const pickedUnit = pickedHost?.slaves?.[uIdx]?.unitId ?? (pickedHost?.slaves?.[0]?.unitId ?? null)
      setSelectedUnitId(pickedUnit)

    }catch(e:any){ alert('匯入失敗: '+(e?.message||e)) }
  }

  // ===== UI =====
  return (
    <div style={{ padding:24, background:'#f0f2f5', minHeight:'100vh', position:'relative' }}>
      {/* Hosts Drawer: move all hosts list and host-level tools here */}
      <Drawer
        title="主機列表"
        placement="left"
        width={1000}
        onClose={()=> setHostsDrawerOpen(false)}
        open={hostsDrawerOpen}
        bodyStyle={{ padding:'16px', overflow:'auto' }}
      >
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* Host manage toolbar - all in one row */}
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <Input value={hostNameInput} onChange={e=>setHostNameInput(e.target.value)} placeholder="主機名稱" size="middle" style={{ flex:1 }} />
            <Input value={hostAddrInput} onChange={e=>setHostAddrInput(e.target.value)} placeholder="Host" size="middle" style={{ flex:1 }} />
            <InputNumber value={hostPortInput} onChange={v=>setHostPortInput(v||502)} placeholder="Port" size="middle" style={{ flex:1 }} min={1} max={65535} />
            <Button type="primary" icon={<PlusOutlined />} onClick={addHost} size="middle">新增</Button>
          </div>

          {/* Hosts table (no expandable). Click row to select host and close drawer */}
          <Table<HostEntry>            dataSource={hosts}
            rowKey="id"
            pagination={false}
            size="middle"
            locale={{ emptyText: '尚未新增主機' }}
            rowClassName={(h)=> h.id===selectedHostId? 'selected-row' : ''}
            style={{ cursor:'pointer' }}
            onRow={(h)=>({
              onClick: () => {
                setSelectedHostId(h.id);
                // 顯示 5 秒提示，請使用者暫停操作，並鎖定 UI
                showHostSwitchNotice()
                setHostsDrawerOpen(false);
              },
              style: { 
                cursor:'pointer',
                transition: 'background-color 0.2s',
              }
            })}
            columns={[
              { title: '主機名', dataIndex: 'name', key: 'name', width: 150, render: (name) => <Text strong>{name}</Text> },
              { title: '位址', key: 'address', width: 120, render: (_:any,h:HostEntry) => <Text type="secondary" style={{fontSize:12}}>{h.host}:{h.port}</Text> },
              { title: '連線', key: 'connection', width: 200, render: (_:any,h:HostEntry) => (
                <Space direction="horizontal" size={8} align="center">
                  <Button size="small" icon={<ApiOutlined />} onClick={(e)=>{ e.stopPropagation(); connectHost(h) }} loading={connMap[h.id]==='connecting'}>
                    連線
                  </Button>
                  <Button size="small" danger onClick={(e)=>{ e.stopPropagation(); setConnMap(m=> ({ ...m, [h.id]: 'idle' })) }} disabled={connMap[h.id]!== 'ok'}>
                    斷線
                  </Button>
                  <Tag color={connMap[h.id]==='ok'?'success': connMap[h.id]==='fail'?'error':'default'} style={{marginTop:0}}>
                    {connMap[h.id]==='connecting'?'連線中': connMap[h.id]==='ok'?'已連': connMap[h.id]==='fail'?'失敗':'未連'}
                  </Tag>
                </Space>
              )},
              { title: '操作', key: 'actions', width: 280, render: (_:any,h:HostEntry) => (
                <Space onClick={e=> e.stopPropagation()} size="small">
                  <Tooltip title="編輯"><Button size="small" icon={<EditOutlined />} onClick={()=>{
                    Modal.confirm({
                      title: `編輯主機 ${h.name}`,
                      content: (
                        <Space direction="vertical" style={{width:'100%'}}>
                          <Input placeholder="名稱" defaultValue={h.name} id={`edit-host-name-${h.id}`} />
                          <Input placeholder="Host" defaultValue={h.host} id={`edit-host-host-${h.id}`} />
                          <InputNumber placeholder="Port" defaultValue={h.port} id={`edit-host-port-${h.id}`} min={1} max={65535} style={{width:'100%'}} />
                        </Space>
                      ),
                      onOk: ()=>{
                        const nameEl = document.getElementById(`edit-host-name-${h.id}`) as HTMLInputElement
                        const hostEl = document.getElementById(`edit-host-host-${h.id}`) as HTMLInputElement
                        const portEl = document.getElementById(`edit-host-port-${h.id}`) as HTMLInputElement
                        const newName = (nameEl?.value||'').trim()
                        const newHost = (hostEl?.value||'').trim()
                        const newPort = Number((portEl as any)?.value || h.port)
                        setHosts(list=> list.map(x=> x.id===h.id? { ...x, name: newName||x.name, host: newHost||x.host, port: isNaN(newPort)? x.port : newPort } : x))
                      }
                    })
                  }}/></Tooltip>
                  <Tooltip title="刪除主機"><Button size="small" danger icon={<DeleteOutlined />} onClick={()=>{
                    Modal.confirm({
                      title: '確認刪除',
                      content: `確定要刪除主機 "${h.name}" 嗎?`,
                      okText: '刪除',
                      okType: 'danger',
                      cancelText: '取消',
                      onOk: () => deleteHost(h.id)
                    })
                  }}/></Tooltip>
                  <Button size="small" onClick={(e)=>{ e.stopPropagation(); openMapModal(h) }}>群組/場景 對應</Button>
                  <Button size="small" type="primary" onClick={(e)=>{ e.stopPropagation(); setSelectedHostId(h.id); showHostSwitchNotice(); setHostsDrawerOpen(false) }}>選擇主機</Button>
                </Space>
              )}
            ]}
          />
        </div>
      </Drawer>
  <Space direction="vertical" size="large" style={{ width:'100%', filter: uiLocked? 'grayscale(60%)' : undefined }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
          <Title level={2} style={{margin:0, flex:'0 0 auto'}}>Modbus 控制（單頁整合）</Title>
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={()=> setHostsDrawerOpen(true)} disabled={uiLocked}>主機清單</Button>
            <Button icon={<SaveOutlined />} onClick={exportToFile} disabled={!hosts.length || uiLocked}>匯出 JSON</Button>
            <Button icon={<FolderOpenOutlined />} onClick={importFromFile} disabled={uiLocked}>匯入 JSON</Button>
            {/* 快捷開關：群組/場景（TCP 直接寫入主機暫存器） */}
            <Select
              style={{width:160}}
              placeholder="群組（選擇）"
              value={quickGroupSel}
              onChange={async (v)=>{ if(uiLocked) return; 
                if(quickGroupSel && quickGroupOn){
                  // 先關起來
                  await quickSetGroup(false)
                }
                // 再切換到新群組
                setQuickGroupSel(v)
              }}
              options={Array.from({length:32},(_,i)=>({ value:i+1, label:`群組 ${i+1}` }))}
              disabled={uiLocked}
            />
            <Switch
              checked={quickGroupOn}
              onChange={async (on)=>{ if(uiLocked) return; setQuickGroupOn(on); await quickSetGroup(on) }}
              checkedChildren="開"
              unCheckedChildren="關"
              disabled={uiLocked}
            />
            <Select
              style={{width:180}}
              placeholder="場景（選擇）"
              value={quickSceneSel}
              onChange={async (v)=>{ if(uiLocked) return; setQuickSceneSel(v); if(v!=null){ await quickOpenScene(v) } }}
              options={computeSceneOptions()}
              disabled={uiLocked}
            />
            <Text style={{fontSize:12}}>全部主機</Text>
            <Switch
              checked={triggerAllHosts}
              onChange={(on)=>{ if(uiLocked) return; setTriggerAllHosts(on) }}
              checkedChildren="開"
              unCheckedChildren="關"
              disabled={uiLocked}
            />
          </Space>
        </div>

        <Row gutter={16}>
          {/* 左側：選定主機的從機清單 */}
          <Col span={12}>
            <Card 
              title={<span style={{fontSize:14, fontWeight:600}}>從機清單</span>}
              bordered={false}
              style={{ boxShadow:'0 1px 4px rgba(0,0,0,0.08)', height:'100%' }}
              bodyStyle={{ padding:'12px' }}
              extra={<Text type="secondary" style={{fontSize:12}}>{curHost? `${curHost.name}` : '未選擇'}</Text>}
            >
              {!curHost ? (
                <div style={{ textAlign:'center', padding:'40px 20px', color:'#999' }}>
                  <Text type="secondary">請點擊左側「主機」按鈕選擇主機</Text>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom:12 }}>
                    <Space wrap>
                      <Button type="primary" size="small" icon={<PlusOutlined />} disabled={uiLocked} onClick={()=>{
                        const h = curHost
                        Modal.confirm({
                          title: '新增從機',
                          content: (
                            <Space direction="vertical" style={{width:'100%'}}>
                              <Input placeholder="名稱（選填）" id={`slaveNameInput-left-${h.id}`} />
                              <InputNumber min={0} max={254} placeholder="輸入 unitId" id={`unitIdInput-left-${h.id}`} style={{width:'100%'}} />
                            </Space>
                          ),
                          onOk: () => {
                            const input = document.getElementById(`unitIdInput-left-${h.id}`) as HTMLInputElement;
                            const nameEl = document.getElementById(`slaveNameInput-left-${h.id}`) as HTMLInputElement;
                            const v = Number(input?.value);
                            const nm = (nameEl?.value||'').trim();
                            if(isNaN(v)) { message.error('請輸入有效的站號'); return }
                            if(h.slaves.some(s=> s.unitId===v)) { message.error('該站號已存在'); return }
                            addSlave(h, v, nm);
                          }
                        })
                      }}>新增從機</Button>
                      <Button size="small" onClick={readAllLights} disabled={uiLocked}>讀取燈號</Button>
                      <Button size="small" onClick={readAllDimming} disabled={uiLocked}>讀取調光值</Button>
                      <Button size="small" type={autoPolling ? 'primary' : 'default'} 
                        onClick={()=> { if(uiLocked) return; autoPolling ? stopAutoPolling() : startAutoPolling() }} disabled={uiLocked}
                      >
                        {autoPolling ? '停止輪詢' : '自動輪詢'}
                      </Button>
                      <Switch size="small" checked={parallelPolling} onChange={setParallelPolling} disabled={uiLocked} />
                      <Text type="secondary" style={{fontSize:12}}>並行輪詢</Text>
                      {/* 已移除：4CH 只讀 CH2（固定讀取全通道） */}
                    </Space>
                  </div>
                  <Table<SlaveEntry>
                    dataSource={curHost.slaves}
                    rowKey="unitId"
                    size="middle"
                    pagination={false}
                    locale={{ emptyText: '無從機' }}
                    rowClassName={(s)=> (curHost.id===selectedHostId && s.unitId===selectedUnitId)? 'selected-row' : ''}
                    style={{ fontSize:13 }}
                    columns={[
                      { title: '站號', dataIndex: 'unitId', key: 'unitId', width: 50, render: (u:number) => <Text strong>U{u}</Text> },
                      { title: '名稱', dataIndex: 'name', key: 'name', width: 180, render: (n:string|undefined) => n? <Text>{n}</Text> : <Text type="secondary" style={{fontSize:12}}>未命名</Text> },
                      { title: '類型', dataIndex: 'typeValue', key: 'typeValue', width: 90, render: (v:number|null) => <Text type={v? undefined : 'secondary'} style={{fontSize:12}}>{v===1? 'SW8CH' : v===2? '4CH' : '—'}</Text> },
                      { title: '燈號', key: 'lights', width: 280, render: (_:any, s: SlaveEntry) => {
                        const numLights = s.typeValue === 1 ? 8 : s.typeValue === 2 ? 4 : 0;
                        if (numLights === 0) return <Text type="secondary">—</Text>;
                        const k = keyOf(curHost.id, s.unitId)
                        const mask = maskByKey[k] ?? 0
                        const bright = bright4ByKey[k] || [0,0,0,0]
                        return (
                          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                            {Array.from({length: numLights}).map((_,i) => {
                              const on = ((mask>>i)&1)===1
                              const color = on? '#fadb14' : '#d9d9d9'
                              const glow = on? '0 0 6px rgba(250,219,20,0.7), 0 0 12px rgba(250,219,20,0.45)' : 'none'
                              return (
                                <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                                  <BulbFilled style={{ fontSize:20, color, textShadow: glow as any }} />
                                  {s.typeValue === 2 && (
                                    <InputNumber size="small" min={0} max={255} value={bright[i]||0} style={{ width:45, textAlign:'center' }} readOnly />
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        );
                      }},
                      { title: '操作', key: 'act', width: 100, render: (_:any, s: SlaveEntry) => (
                        <Space size="small" style={{ justifyContent:'center' }}>
                          <Tooltip title="選擇"><Button size="small" type="primary" disabled={uiLocked} icon={<CheckOutlined />} onClick={async()=>{ 
                            setSelectedHostId(curHost.id); 
                            setSelectedUnitId(s.unitId);
                            // 不發起讀取；操作面板會由全域快取即時顯示
                          }} /></Tooltip>
                          <Tooltip title="編輯"><Button size="small" icon={<EditOutlined />} disabled={uiLocked} onClick={()=>{
                            const h = curHost
                            Modal.confirm({
                              title: `編輯 U${s.unitId}`,
                              content: (
                                <Space direction="vertical" style={{width:'100%'}}>
                                  <Input placeholder="名稱" defaultValue={s.name} id={`edit-slave-name-${h.id}-${s.unitId}`} />
                                  <InputNumber min={0} max={254} placeholder="站號" defaultValue={s.unitId} id={`edit-slave-unit-${h.id}-${s.unitId}`} style={{width:'100%'}} />
                                </Space>
                              ),
                              onOk: ()=>{
                                const h = curHost
                                if(!h) return
                                const nameEl = document.getElementById(`edit-slave-name-${h.id}-${s.unitId}`) as HTMLInputElement
                                const unitEl = document.getElementById(`edit-slave-unit-${h.id}-${s.unitId}`) as HTMLInputElement
                                const newName = (nameEl?.value||'').trim()
                                const newUnit = clamp(Number((unitEl as any)?.value ?? s.unitId), 0, 254)
                                const dup = h.slaves.some(ss=> ss.unitId===newUnit && ss.unitId!==s.unitId)
                                if(dup){ message.error('該站號已存在'); return Promise.reject() as any }
                                setHosts(list=> list.map(x=> {
                                  if(x.id!==h.id) return x
                                  const updated = x.slaves.map(ss=> ss.unitId===s.unitId? { ...ss, unitId:newUnit, name: newName } : ss)
                                  const sorted = updated.sort((a,b)=> a.unitId-b.unitId)
                                  return { ...x, slaves: sorted }
                                }))
                                if(selectedHostId===h.id && selectedUnitId===s.unitId){ setSelectedUnitId(newUnit) }
                              }
                            })
                          }} /></Tooltip>
                          <Tooltip title="刪除"><Button size="small" danger icon={<DeleteOutlined />} disabled={uiLocked} onClick={()=> deleteSlave(curHost, s.unitId)} /></Tooltip>
                        </Space>
                      )}
                    ]}
                  />
                </>
              )}
            </Card>
          </Col>

          {/* 右側 1/2：操作面板 */}
          <Col span={12}>
            <Card 
              title={<span style={{fontSize:14, fontWeight:600}}>操作面板</span>}
              bordered={false}
              style={{ boxShadow:'0 1px 4px rgba(0,0,0,0.08)', height:'100%' }}
              bodyStyle={{ padding:'12px' }}
              extra={<Text type="secondary" style={{fontSize:12}}>{selectedUnitId!=null ? `U${selectedUnitId}` : '未選'}</Text>}
            >
        {!curHost || selectedUnitId==null ? (
          <div style={{ textAlign:'center', padding:'40px 20px', color:'#999' }}>
            <Text type="secondary">請在左側選擇一個從機</Text>
          </div>
        ) : (
          <Space direction="vertical" size="middle" style={{width:'100%'}}>
            {/* Type registration + Mask (combined) */}
            <Card type="inner" title={<span style={{fontSize:13, fontWeight:500}}>設備設定</span>} size="small">
              <Space direction="vertical" style={{ width:'100%' }} size="small">
                {/* 類型註冊 */}
                <Space wrap style={{width:'100%'}}>
                  <Space>
                    <Text>類型:</Text>
                    <Select 
                      style={{ width:150 }} 
                      value={curSlave?.typeValue ?? undefined} 
                      placeholder="選擇類型"
                      onChange={async v=> { if(uiLocked) return; 
                        setSyncing(true)
                        await writeType(curHost, selectedUnitId!, v)
                        await syncByType(curHost, selectedUnitId!, v)
                      }}
                      options={[
                        {value:1, label:'1 (SW8CH)'},
                        {value:2, label:'2 (4CH)'}
                      ]}
                      disabled={uiLocked}
                    />
                  </Space>
                  {/* 面板讀取按鈕移除：統一在左側工具或自動輪詢觸發，這裡僅顯示狀態 */}
                  {syncing && <Text type="secondary">同步中…</Text>}
                </Space>
                {/* PDU 預覽移除 */}

                {/* 單寄存器遮罩（合併進同卡片；以燈號 icon 呈現） */}
                <div style={{ marginTop:12 }}>

                  {/* SW8：8 顆燈分成兩行，每行 4 個 */}
                  {curSlave?.typeValue===1 && (
                    <>
                      <Row gutter={[8,8]} style={{ marginTop:8, filter: syncing? 'grayscale(30%)': undefined, opacity: syncing? 0.85: 1 }}>
                        {Array.from({length:4}).map((_,i)=>{
                          const unit = selectedUnitId||0
                          const chNames = getChNames(unit)
                          const on = ((maskValue>>i)&1)===1;
                          const color = on? '#fadb14' : '#d9d9d9';
                          const glow = on? '0 0 8px rgba(250,219,20,0.9), 0 0 16px rgba(250,219,20,0.6)' : 'none';
                          return (
                            <Col span={6} key={i}>
                              <Space direction="vertical" size={0} style={{width:'100%', alignItems:'center'}}>
                                <BulbFilled style={{ fontSize:32, color, textShadow: glow as any, cursor:'pointer' }}
                                  onClick={async()=>{ if(uiLocked) return;
                                    const prev = maskValue;
                                    const newMask = on? (prev & ~(1<<i)) : (prev | (1<<i));
                                    // UI 先樂觀更新
                                    setMaskValue(newMask & 0xff);
                                    try{
                                      await writeMask(curHost, selectedUnitId as number, newMask & 0xff);
                                    }catch(e){
                                      // 失敗還原
                                      setMaskValue(prev);
                                      message.error('遮罩寫入失敗');
                                    }
                                  }}
                                />
                                <Input size="small" value={chNames[i]} disabled={uiLocked}
                                  onChange={(e)=>{
                                    const name = e.target.value
                                    setChNamesByUnit(prev=>{
                                      const arr = (prev[unit]?.slice() || ['CH1','CH2','CH3','CH4','CH5','CH6','CH7','CH8'])
                                      arr[i] = name
                                      return { ...prev, [unit]: arr }
                                    })
                                  }}
                                  style={{ width:120, textAlign:'center' }}
                                />
                              </Space>
                            </Col>
                          )
                        })}
                      </Row>
                      <Row gutter={[8,8]} style={{ marginTop:8, filter: syncing? 'grayscale(30%)': undefined, opacity: syncing? 0.85: 1 }}>
                        {Array.from({length:4}).map((_,i)=>{
                          const idx = i + 4
                          const unit = selectedUnitId||0
                          const chNames = getChNames(unit)
                          const on = ((maskValue>>idx)&1)===1;
                          const color = on? '#fadb14' : '#d9d9d9';
                          const glow = on? '0 0 8px rgba(250,219,20,0.9), 0 0 16px rgba(250,219,20,0.6)' : 'none';
                          return (
                            <Col span={6} key={idx}>
                              <Space direction="vertical" size={0} style={{width:'100%', alignItems:'center'}}>
                                <BulbFilled style={{ fontSize:32, color, textShadow: glow as any, cursor:'pointer' }}
                                  onClick={async()=>{ if(uiLocked) return;
                                    const prev = maskValue;
                                    const newMask = on? (prev & ~(1<<idx)) : (prev | (1<<idx));
                                    // UI 先樂觀更新
                                    setMaskValue(newMask & 0xff);
                                    try{
                                      await writeMask(curHost, selectedUnitId as number, newMask & 0xff);
                                    }catch(e){
                                      // 失敗還原
                                      setMaskValue(prev);
                                      message.error('遮罩寫入失敗');
                                    }
                                  }}
                                />
                                <Input size="small" value={chNames[idx]} disabled={uiLocked}
                                  onChange={(e)=>{
                                    const name = e.target.value
                                    setChNamesByUnit(prev=>{
                                      const arr = (prev[unit]?.slice() || ['CH1','CH2','CH3','CH4','CH5','CH6','CH7','CH8'])
                                      arr[idx] = name
                                      return { ...prev, [unit]: arr }
                                    })
                                  }}
                                  style={{ width:120, textAlign:'center' }}
                                />
                              </Space>
                            </Col>
                          )
                        })}
                      </Row>
                    </>
                  )}

                  {/* 4CH：4 顆燈 + 數值輸入框；使用 Modbus TCP 直接寫入調光暫存器（5000 起） */}
                  {curSlave?.typeValue===2 && (
                    <Row gutter={[12,12]} style={{ marginTop:8, filter: syncing? 'grayscale(30%)': undefined, opacity: syncing? 0.85: 1 }}>
                      {Array.from({length:4}).map((_,i)=>{
                        const unit = selectedUnitId||0
                        const chNames = getChNames(unit)
                        const val = brightness4[i] ?? 0; // 0..255
                        const on = ((maskValue>>i)&1)===1; // 4CH 燈號以遮罩位判斷 on/off
                        const intensity = Math.max(0, Math.min(1, val/255));
                        const color = on? `rgba(250,219,20,${0.6 + 0.4*intensity})` : '#d9d9d9';
                        const glow = on? `0 0 ${6+10*intensity}px rgba(250,219,20,${0.6*intensity})` : 'none';
                        return (
                          <Col span={6} key={i}>
                            <Space direction="vertical" style={{width:'100%'}} size={4}>
                              <div style={{display:'flex', justifyContent:'center', alignItems:'center', gap:8}}>
                                <BulbFilled style={{ fontSize:36, color, textShadow: glow as any, cursor:'pointer', opacity: uiLocked? 0.6: 1 }}
                                  onClick={async()=>{ if(uiLocked) return;
                                    const unit = selectedUnitId as number
                                    // 直接寫入切換遮罩（靜默），UI 由左側讀取/自動輪詢更新
                                    const curr = maskValue
                                    const nextMask = !on ? ((curr | (1<<i)) & 0x0f) : ((curr & ~(1<<i)) & 0x0f)
                                    try{
                                      await writeMask(curHost, unit, nextMask, true)
                                    }catch(e){
                                      message.error('遮罩寫入失敗')
                                    }
                                  }}
                                />
                                <InputNumber min={0} max={255} value={val} size="small" style={{width:60}} disabled={uiLocked}
                                  onChange={(n)=>{
                                    const newVal = Number(n) || 0
                                    setBrightness4(brightness4.map((vv,idx)=> idx===i? newVal: vv));
                                  }}
                                  onBlur={async()=>{
                                    if(uiLocked) return; await writeDimming(curHost, selectedUnitId, i, val);
                                  }}
                                />
                              </div>
                              <Input size="small" value={chNames[i]}
                                onChange={(e)=>{
                                  const name = e.target.value
                                  setChNamesByUnit(prev=>{
                                    const arr = (prev[unit]?.slice() || ['CH1','CH2','CH3','CH4'])
                                    arr[i] = name
                                    return { ...prev, [unit]: arr }
                                  })
                                }}
                                style={{ width:'100%', textAlign:'center' }}
                              />
                            </Space>
                          </Col>
                        )
                      })}
                    </Row>
                  )}
                </div>
              </Space>
            </Card>

            {/* 遮罩卡片已合併至設備註冊卡片 */}

            {/* 485 Scenes/Groups 僅在已選擇從機且其類型已設定時顯示 */}
            {curSlave?.typeValue ? (<>
            <Card type="inner" title="場景（0x1A/0x18）" size="small">
              <Space wrap style={{marginBottom:12}}>
                <Space>
                  <Text>Range:</Text>
                  <Select value={sceneRange} onChange={v=> setSceneRange(v)} style={{width:120}} options={[{value:1,label:'1..16'},{value:2,label:'17..32'},{value:3,label:'33..48'},{value:4,label:'49..64'}]} disabled={uiLocked} />
                </Space>
                <Space>
                  <Checkbox checked={sceneEnableLow} onChange={e=> setSceneEnableLow(e.target.checked)} disabled={uiLocked}>啟用 1..8</Checkbox>
                  <Checkbox checked={sceneEnableHigh} onChange={e=> setSceneEnableHigh(e.target.checked)} disabled={uiLocked}>啟用 9..16</Checkbox>
                </Space>
                <Button size="middle" type="primary" disabled={uiLocked} onClick={async()=>{
                  const key='scene-send'
                  message.loading({ content:'發送中…', key, duration:0 })
                  try{
                    const r= await send485(sceneWrite)
                    emitLog('SCENE-W', toHexSp(sceneWrite), r)
                    message.success({ content:'完成', key })
                  }catch(e:any){
                    message.error({ content: '發送失敗', key })
                  }
                }}>送出 0x1A</Button>
              </Space>
              <Table
                dataSource={(getSceneRows()).filter(r=> (r.index<=8? sceneEnableLow : sceneEnableHigh))}
                rowKey="key"
                pagination={false}
                size="small"
                locale={{ emptyText: '尚未新增列' }}
                columns={[
                  { title: '編號', dataIndex: 'index', key: 'index', width: 90, render: (_:any, r:any)=> (<Text>{r.index}</Text>)},
                  { title: '名稱', dataIndex: 'name', key: 'name', width: 220, render: (_:any, r:any)=> {
                    // 名稱改為從對應設定取得，不在此編輯
                    const text = sceneDisplayName(r.index) || ''
                    return text? <Text>{text}</Text> : <Text type="secondary" style={{fontSize:12}}>未命名</Text>
                  }},
                  { title: '燈號', key: 'toggles', render: (_:any, r:any)=> (
                    slaveType===1 ? (
                      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                        {Array.from({length: 8}).map((_,i)=>{
                          const on = !!(r.toggles?.[i])
                          const color = on? '#fadb14' : '#d9d9d9'
                          const glow = on? '0 0 6px rgba(250,219,20,0.7), 0 0 12px rgba(250,219,20,0.45)' : 'none'
                          return (
                            <Tooltip key={i} title={`CH${i+1}`}>
                              <BulbFilled
                                style={{ fontSize:18, color, textShadow: glow as any, cursor:'pointer', opacity: uiLocked? 0.6: 1 }}
                                onClick={()=> { if(uiLocked) return; toggleSceneRowLight(r.key, i) }}
                              />
                            </Tooltip>
                          )
                        })}
                      </div>
                    ) : (
                      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                        {Array.from({length:4}).map((_,i)=> (
                          <InputNumber
                            key={i}
                            min={0}
                            max={255}
                            step={1}
                            size="small"
                            value={(r.values?.[i]) ?? 0}
                            style={{ width:52, textAlign:'center' }}
                            onChange={(val)=> { if(uiLocked) return; setSceneRowValue(r.key, i, Number(val)||0) }}
                            disabled={uiLocked}
                          />
                        ))}
                      </div>
                    )
                  )},
                  // 操作列移除（不可新增/刪除/編號編輯）
                ]}
              />
              <Space wrap style={{marginTop:12}}>
                <Text code style={{fontSize:12}}>{toHexSp(sceneWrite)}</Text>
              </Space>
            </Card>

            {/* 485 Groups */}
            <Card type="inner" title="群組（0x19/0x17）" size="small">
              <Space wrap style={{marginBottom:12}}>
                <Space>
                  <Text>Range:</Text>
                  <Select value={groupRange} onChange={v=> setGroupRange(v)} style={{width:120}} options={[{value:1,label:'1..16'},{value:2,label:'17..32'}]} disabled={uiLocked} />
                </Space>
                <Space>
                  <Checkbox checked={groupEnableLow} onChange={e=> setGroupEnableLow(e.target.checked)} disabled={uiLocked}>啟用 1..8</Checkbox>
                  <Checkbox checked={groupEnableHigh} onChange={e=> setGroupEnableHigh(e.target.checked)} disabled={uiLocked}>啟用 9..16</Checkbox>
                </Space>
                <Button size="middle" type="primary" disabled={uiLocked} onClick={async()=>{
                  const key='group-send'
                  message.loading({ content:'發送中…', key, duration:0 })
                  try{
                    const r= await send485(groupWrite)
                    emitLog('GROUP-W', toHexSp(groupWrite), r)
                    message.success({ content:'完成', key })
                  }catch(e:any){
                    message.error({ content:'發送失敗', key })
                  }
                }}>送出 0x19</Button>
              </Space>
              <Table
                dataSource={(getGroupRows()).filter(r=> (r.index<=8? groupEnableLow : groupEnableHigh))}
                rowKey="key"
                pagination={false}
                size="small"
                locale={{ emptyText: '尚未新增列' }}
                columns={[
                  { title: '編號', dataIndex: 'index', key: 'index', width: 90, render: (_:any, r:any)=> (<Text>{r.index}</Text>)},
                  { title: '名稱', dataIndex: 'name', key: 'name', width: 220, render: (_:any, r:any)=> {
                    // 群組名稱來自主機的群組命名；不允許在此編輯
                    const name = groupDisplayName(r.index) || r.name || ''
                    return name? <Text>{name}</Text> : <Text type="secondary" style={{fontSize:12}}>未命名</Text>
                  }},
                  { title: '燈號', key: 'toggles', render: (_:any, r:any)=> (
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                      {Array.from({length: slaveType===1?8:4}).map((_,i)=>{
                        const on = !!r.toggles[i]
                        const color = on? '#fadb14' : '#d9d9d9'
                        const glow = on? '0 0 6px rgba(250,219,20,0.7), 0 0 12px rgba(250,219,20,0.45)' : 'none'
                        return (
                          <Tooltip key={i} title={`CH${i+1}`}>
                            <BulbFilled
                              style={{ fontSize:18, color, textShadow: glow as any, cursor:'pointer', opacity: uiLocked? 0.6: 1 }}
                              onClick={()=> { if(uiLocked) return; toggleGroupRowLight(r.key, i) }}
                            />
                          </Tooltip>
                        )
                      })}
                    </div>
                  )},
                  // 操作列移除（不可新增/刪除/編號編輯）
                ]}
              />
              <Space wrap style={{marginTop:12}}>
                <Text code style={{fontSize:12}}>{toHexSp(groupWrite)}</Text>
              </Space>
            </Card>
            </>) : null}

            {/* 原生十六進位發送功能已移除（依需求） */}
          </Space>
        )}
            </Card>
          </Col>
        </Row>

      {/* Logs */}
      {/* 日誌已移至 App Header 的跑馬燈顯示 */}
      {/* Mapping Modal */}
      <Modal
        open={!!mapModalHostId}
        onCancel={closeMapModal}
        width={980}
        title="群組/場景對應設定"
        footer={null}
      >
        {mapModalHostId && (
          <Space direction="vertical" style={{width:'100%'}}>
            <Space>
              <Button size="small" onClick={async()=>{
                const h = hosts.find(x=> x.id===mapModalHostId)
                if(!h) return
                const vals = await readMapping(h)
                if(vals){
                  setMappingByHost(prev=> ({...prev, [h.id]: vals}))
                  // 依讀回值重建 rows（只列出已設定的）
                  const names = mappingNamesByHost[h.id] || []
                  const rows:MappingRow[] = []
                  for(let i=0;i<48;i++){
                    const g = vals[i] || 0
                    if(g>0){ rows.push({ key:`${i+1}`, scene:i+1, group:g, name:names[i]||'', editing:false }) }
                  }
                  setMapRows(rows)
                }
              }}>讀取</Button>
              <Button size="small" type="primary" onClick={async()=>{
                const h = hosts.find(x=> x.id===mapModalHostId)
                if(!h) return
                const key='map-save'
                message.loading({ content:'發送中…', key, duration:0 })
                // 以 rows 直接寫入（0-based）
                await writeMappingRows(h, mapRows)
                // 名稱本地保存
                const names = Array(48).fill('')
                for(const r of mapRows){ if(r.scene>=1 && r.scene<=48) names[r.scene-1] = r.name||'' }
                setMappingNamesByHost(prev=> ({ ...prev, [h.id]: names }))
                message.success({ content:'完成', key })
              }}>儲存</Button>
              <Button size="small" onClick={addMapRow}>新增一列</Button>
            </Space>
            <Table
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={mapRows}
              columns={[
                { title:'場景名稱', dataIndex:'name', width:300, render:(v:any, r:MappingRow)=> r.editing? (
                  <Input value={r.name} onChange={e=> updateMapRow(r.key, { name: e.target.value })} />
                ) : (<span>{r.name||'-'}</span>) },
                { title:'場景', dataIndex:'scene', width:120, render:(v:any, r:MappingRow)=> r.editing? (
                  <Select value={r.scene} style={{width:100}} onChange={val=> updateMapRow(r.key, { scene: val })} options={Array.from({length:48},(_,i)=>({ value:i+1, label:`${i+1}` }))} />
                ) : (<span>{r.scene}</span>) },
                { title:'對應群組', dataIndex:'group', width:160, render:(v:any, r:MappingRow)=> r.editing? (
                  <Select value={r.group} style={{width:140}} onChange={val=> updateMapRow(r.key, { group: val })} options={[{value:0,label:'未設定'}, ...Array.from({length:32},(_,i)=>({ value:i+1, label:`群組 ${i+1}` }))]} />
                ) : (<span>{r.group>0? `群組 ${r.group}` : '未設定'}</span>) },
                { title:'群組名稱', dataIndex:'groupName', width:200, render:(v:any, r:MappingRow)=> {
                  const hid = mapModalHostId!
                  const gnames = groupNamesByHost[hid] || []
                  const curr = (r.group>=1 && r.group<=32)? (gnames[r.group-1] || '') : ''
                  if(r.editing){
                    return r.group>=1 && r.group<=32 ? (
                      <Input defaultValue={curr} onBlur={(e)=>{
                        const val = (e.target.value||'').trim()
                        setGroupNamesByHost(prev=>{
                          const arr = (prev[hid]?.slice() || Array(32).fill(''))
                          arr[r.group-1] = val
                          return { ...prev, [hid]: arr }
                        })
                      }} />
                    ) : <Text type="secondary" style={{fontSize:12}}>—</Text>
                  }
                  return curr? <span>{curr}</span> : <span style={{color:'#999'}}>—</span>
                }},
                { title:'操作', key:'op', width:160, render: (_:any, r:MappingRow)=> (
                  <Space>
                    {r.editing? (
                      <Button size="small" type="primary" onClick={()=> updateMapRow(r.key, { editing:false })}>完成</Button>
                    ) : (
                      <Button size="small" onClick={()=> updateMapRow(r.key, { editing:true })}>編輯</Button>
                    )}
                    <Button size="small" danger onClick={()=> deleteMapRow(r.key)}>刪除</Button>
                  </Space>
                )}
              ]}
            />
            <Typography.Paragraph type="secondary" style={{marginTop:8}}>最多 48 筆；儲存會寫入 24100..24147（0=未設定）。</Typography.Paragraph>
          </Space>
        )}
      </Modal>
      </Space>
      {uiLocked && (
        <div style={{ position:'fixed', inset:0, zIndex: 9999, background:'rgba(255,255,255,0.35)', pointerEvents:'auto' }} />
      )}
    </div>
  )
}
