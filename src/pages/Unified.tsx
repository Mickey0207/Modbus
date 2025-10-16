import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, Input, Button, Select, Table, Space, Tag, Typography, Row, Col, InputNumber, Checkbox, Slider, Modal, message, Tooltip, Switch } from 'antd'
import { PlusOutlined, DeleteOutlined, SaveOutlined, FolderOpenOutlined, ApiOutlined, BulbFilled, SettingOutlined, EditOutlined } from '@ant-design/icons'

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
  const delayedReadTimersRef = useRef<number[]>([0,0,0,0])
  const [chNamesByUnit, setChNamesByUnit] = useState<Record<number, string[]>>({})
  const getChNames = (unit:number)=> chNamesByUnit[unit] || ['CH1','CH2','CH3','CH4']
  const [syncing, setSyncing] = useState(false)

  // ===== Quick Switch (群組/場景，依規格位址直寫) =====
  // 25400..25431 對應群組 1..32（寫 1 開、0 關）
  // 24100..24147 場景 1..48 對應群組號（寫入群組編號）
  // 20000 + (group-1)*48 + (scene-1) 寫 1 觸發該群組的該場景
  const [quickGroupSel, setQuickGroupSel] = useState<number|undefined>(undefined)
  const [quickSceneSel, setQuickSceneSel] = useState<number|undefined>(undefined)
  const [quickGroupOn, setQuickGroupOn] = useState<boolean>(false)
  const [quickSceneOn, setQuickSceneOn] = useState<boolean>(false)
  const [autoOffOnSceneSel, setAutoOffOnSceneSel] = useState<boolean>(false)
  const [autoOffOnGroupSel, setAutoOffOnGroupSel] = useState<boolean>(false)
  // 觸發對象：已連線主機或全部
  const [triggerTarget, setTriggerTarget] = useState<'_all'|string|undefined>(undefined) // host.id 或 '_all'
  // 每台主機的場景→群組對應（長度 48；0 表未設定）
  const [mappingByHost, setMappingByHost] = useState<Record<string, number[]>>({})
  const [mappingNamesByHost, setMappingNamesByHost] = useState<Record<string, string[]>>({})
  const [mappingBaseByHost, setMappingBaseByHost] = useState<Record<string, number[]>>({})
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

  function openTriggerConfig(){
    let tmpTarget: '_all'|string|undefined = triggerTarget
    let tmpAutoScene = autoOffOnSceneSel
    let tmpAutoGroup = autoOffOnGroupSel
    const connected = hosts.filter(h=> connMap[h.id]==='ok')
    Modal.confirm({
      title: '選擇觸發對象（主機）',
      content: (
        <Space direction="vertical" style={{width:'100%'}}>
          <Select
            style={{width:'100%'}}
            placeholder="選擇要發送的主機"
            defaultValue={tmpTarget}
            onChange={(v)=>{ tmpTarget = v as any }}
            options={[{value:'_all', label:'全部主機'}, ...connected.map(h=>({ value:h.id, label:`${h.name} (${h.host}:${h.port})` }))]}
          />
          <Space>
            <Checkbox defaultChecked={tmpAutoScene} onChange={e=>{ tmpAutoScene = e.target.checked }}>切換場景時自動關燈</Checkbox>
            <Checkbox defaultChecked={tmpAutoGroup} onChange={e=>{ tmpAutoGroup = e.target.checked }}>切換群組時自動關燈</Checkbox>
          </Space>
          <Typography.Paragraph type="secondary" style={{margin:0}}>
            之後按「開啟」會發送到此處選擇的主機（或全部）。
          </Typography.Paragraph>
        </Space>
      ),
      okText: '儲存',
      onOk: ()=>{ setTriggerTarget(tmpTarget); setAutoOffOnSceneSel(tmpAutoScene); setAutoOffOnGroupSel(tmpAutoGroup) }
    })
  }

  function getTargetHosts(): HostEntry[]{
    const connected = hosts.filter(h=> connMap[h.id]==='ok')
    if(triggerTarget==='_all') return connected
    if(triggerTarget){ return connected.filter(h=> h.id===triggerTarget) }
    return []
  }

  function ensureTarget(){
    const th = getTargetHosts()
    if(th.length===0){ message.info('請先於「觸發設定」選擇主機（或全部主機）且需為已連線狀態'); return false }
    return true
  }

  async function quickOpenGroup(){
    if(!quickGroupSel){ message.warning('請先選擇群組'); return }
    if(!ensureTarget()) return
    const targets = getTargetHosts()
    const group = quickGroupSel
    const addr = 25400 + (group-1)
    for(const h of targets){
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const pkt = buildFC06(tid, 1, addr, 1, true) // UnitId 預設 1
      try{
        const data = await sendHex(h, pkt)
        emitLog('GROUP-ON', toHexSp(pkt), spaced(data))
      }catch(e:any){ message.error(`${h.name} 群組 ${group} 觸發失敗: ${e?.message||'error'}`) }
    }
  message.success(`群組 ${group} 已觸發（${targets.length} 台主機）`)
  // 開啟後同步右側燈號（稍候片刻）
  await delayedSync()
  }

  async function quickSetGroup(on:boolean){
    if(!quickGroupSel){ message.warning('請先選擇群組'); return }
    if(!ensureTarget()) return
    const targets = getTargetHosts()
    const group = quickGroupSel
    const addr = 25400 + (group-1)
    const val = on? 1: 0
    for(const h of targets){
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const pkt = buildFC06(tid, 1, addr, val, true)
      try{
        const data = await sendHex(h, pkt)
        emitLog(on? 'GROUP-ON' : 'GROUP-OFF', toHexSp(pkt), spaced(data))
      }catch(e:any){ message.error(`${h.name} 群組 ${group} ${on?'開啟':'關閉'}失敗: ${e?.message||'error'}`) }
    }
    message.success(`群組 ${group} 已${on?'開啟':'關閉'}（${targets.length} 台主機）`)
  }

  function computeSceneOptions(){
    const targets = getTargetHosts()
    const opts = Array.from({length:48}, (_,i)=>{
      const scene = i+1
      // 若任一主機未設定對應，則禁用
      const anyMissing = targets.some(h=> {
        const map = mappingByHost[h.id]
        const g = map?.[i] ?? 0
        return !(g>=1 && g<=32)
      })
      return { value: scene, label: anyMissing? `場景 ${scene}（沒有設定對應）` : `場景 ${scene}`, disabled: anyMissing }
    })
    return opts
  }

  async function quickOpenScene(){
    if(!quickSceneSel){ message.warning('請先選擇場景'); return }
    if(!ensureTarget()) return
    const scene = quickSceneSel
    const targets = getTargetHosts()
    for(const h of targets){
      const map = mappingByHost[h.id] || []
      const group = map[scene-1] || 0
      if(!(group>=1 && group<=32)){ message.error(`${h.name} 尚未設定場景 ${scene} 對應群組`); continue }
      // 新規格：每 8 場景一個暫存器，寫入 bitmask
      const block = Math.floor((scene-1)/8)
      const bit = (scene-1) % 8
      const addr = 20000 + (group-1)*48 + block*8
      const val = 1 << bit
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const pkt = buildFC06(tid, 1, addr, val, true)
      try{
        const data = await sendHex(h, pkt)
        emitLog('SCENE-ON', toHexSp(pkt), spaced(data))
      }catch(e:any){ message.error(`${h.name} 場景 ${scene} 觸發失敗: ${e?.message||'error'}`) }
    }
  message.success(`場景 ${scene} 已觸發（${targets.length} 台主機）`)
  // 開啟後同步右側燈號（稍候片刻）
  await delayedSync()
  }

  async function quickSetScene(on:boolean){
    if(!quickSceneSel){ message.warning('請先選擇場景'); return }
    if(!ensureTarget()) return
    const scene = quickSceneSel
    const targets = getTargetHosts()
    for(const h of targets){
      const map = mappingByHost[h.id] || []
      const group = map[scene-1] || 0
      if(!(group>=1 && group<=32)){ message.error(`${h.name} 尚未設定場景 ${scene} 對應群組`); continue }
      const block = Math.floor((scene-1)/8)
      const bit = (scene-1) % 8
      const addr = 20000 + (group-1)*48 + block*8
      const val = on ? (1 << bit) : 0
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const pkt = buildFC06(tid, 1, addr, val, true)
      try{
        const data = await sendHex(h, pkt)
        emitLog(on?'SCENE-ON':'SCENE-OFF', toHexSp(pkt), spaced(data))
      }catch(e:any){ message.error(`${h.name} 場景 ${scene} ${on?'開啟':'關閉'}失敗: ${e?.message||'error'}`) }
    }
    message.success(`場景 ${scene} 已${on?'開啟':'關閉'}（${targets.length} 台主機）`)
    // 關閉時強制關燈（單暫存器遮罩）
    if(!on){ try{ await forceMaskOff() }catch{} }
    // 同步右側燈號（稍候片刻）
    await delayedSync()
  }

  async function forceMaskOff(){
    if(!curHost || selectedUnitId==null){ message.info('請先選擇右側的從機'); return }
    // 先樂觀更新 UI 再寫入
    setMaskValue(0)
    setQuickGroupOn(false)
    setQuickSceneOn(false)
    try{ await writeMask(curHost, selectedUnitId, 0) }catch(e){ /* ignore */ }
  }

  async function delayedSync(ms=300){
    if(!curHost || selectedUnitId==null) return
    setSyncing(true)
    const attempts = 3
    for(let i=0;i<attempts;i++){
      await new Promise(r=> setTimeout(r, ms))
      try{ await readMask(curHost, selectedUnitId, curSlave?.typeValue ?? undefined) }catch{}
      if(curSlave?.typeValue===2){ try{ await readDimmingAll(curHost, selectedUnitId) }catch{} }
    }
    setSyncing(false)
  }

  

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
    const base = mappingBaseByHost[h.id]?.slice() || Array(48).fill(0)
    const curr = Array(48).fill(0)
    for(const r of rows){ if(r.scene>=1 && r.scene<=48){ curr[r.scene-1] = clamp(r.group||0, 0, 32) } }
    const diffs: Array<{scene:number, code:number}> = []
    for(let i=0;i<48;i++){
      const before = base[i] // 1..32 or 0
      const after = curr[i]
      if(before !== after){
        // encode 0-based for register
        const code = after>0? (after-1) : 0
        diffs.push({ scene: i+1, code })
      }
    }
    if(diffs.length===0){ message.info('沒有變更需要儲存'); return }
    for(const u of diffs){
      const addr = 24100 + (u.scene-1)
      const tid=(h.tid+1)&0xffff; setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}))
      const pkt = buildFC06(tid, 1, addr, u.code, true)
      try{ const data = await sendHex(h, pkt); emitLog('MAP-W', toHexSp(pkt), spaced(data)) }catch(e:any){ message.error(`${h.name} 場景${u.scene} 對應寫入失敗: ${e?.message||'error'}`) }
    }
    setMappingByHost(prev=> ({ ...prev, [h.id]: curr }))
    setMappingBaseByHost(prev=> ({ ...prev, [h.id]: curr.slice() }))
    message.success(`${h.name} 對應已儲存（${diffs.length} 筆變更）`)
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
    // 依讀回亮度同步 UI 燈號：有值即亮，0 即滅（僅更新 UI 遮罩位，非寫入裝置）
    setMaskValue(prev => {
      const bit = 1 << chIndex
      const cleared = prev & (~bit)
      return (vv>0) ? ((cleared | bit) & 0x0f) : (cleared & 0x0f)
    })
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
      // 逐通道即時更新，降低體感延遲
      setBrightness4(prev => prev.map((vv,idx)=> idx===i? v: vv))
      // 依讀回亮度同步 UI 燈號：有值即亮，0 即滅（僅更新 UI 遮罩位，非寫入裝置）
      setMaskValue(prev => {
        const bit = 1 << i
        const cleared = prev & (~bit)
        return (v>0) ? ((cleared | bit) & 0x0f) : (cleared & 0x0f)
      })
    }
  }
  async function writeMask(h:HostEntry, unit:number, val:number){
    isWritingRef.current = true
    const addr=2000 + 8*unit; const tid=(h.tid+1)&0xffff;
    setHosts(list=> list.map(x=> x.id===h.id?{...x, tid}:{...x}));
    const packet=buildFC06(tid, unit, addr, clamp(val,0,0xffff), true);
    try{
      const data= await sendHex(h, packet);
      emitLog('MASK-W', toHexSp(packet), spaced(data));
      // 同步本地遮罩值（不再干涉 4CH 亮度狀態）
      const nv = (curSlave?.typeValue===2) ? (val & 0x0f) : (val & 0xff);
      setMaskValue(nv)
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
      setMaskValue(nv)
    }
  }

  // 當遮罩為 0（全部關燈）時，讓群組/場景的開關也呈現關閉
  useEffect(()=>{
    if((maskValue & 0xff)===0){
      setQuickGroupOn(false)
      setQuickSceneOn(false)
    }
  }, [maskValue])

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
  // 輪詢已移除：回復為手動讀取（例如按鈕或按燈時讀單通道）

  
  const [slaveType,setSlaveType]=useState<1|2>(1)
  // Scenes
  const [sceneRange,setSceneRange]=useState<1|2|3|4>(1)
  const [enableLow,setEnableLow]=useState(true)
  const [enableHigh,setEnableHigh]=useState(true)
  const [scene8,setScene8]=useState<number[]>(Array(16).fill(0))
  const [scene4,setScene4]=useState<number[][]>(Array.from({length:16},()=>[0,0,0,0]))
  const sceneWrite = useMemo(()=>{ const h=[clamp(selectedUnitId??0,0,254),0x1a,slaveType,sceneRange]; const en=[enableLow?0xff:0x00, enableHigh?0xff:0x00]; const payload=(slaveType===1?scene8:scene4.flat()).map(v=>clamp(v,0,0xff)&0xff); const bytes=[...h,...en,...payload]; const c=crc8(bytes,CRC_PARAMS); return [...bytes,c]},[selectedUnitId,slaveType,sceneRange,enableLow,enableHigh,scene8,scene4])
  const sceneRead = useMemo(()=>{ const b=[clamp(selectedUnitId??0,0,254),0x18,slaveType,sceneRange]; const c=crc8(b,CRC_PARAMS); return [...b,c]},[selectedUnitId,slaveType,sceneRange])
  // Groups
  const [groupRange,setGroupRange]=useState<1|2>(1)
  const [group8,setGroup8]=useState<number[]>(Array(16).fill(0))
  const [group4,setGroup4]=useState<number[]>(Array(16).fill(0))
  const groupWrite = useMemo(()=>{ const h=[clamp(selectedUnitId??0,0,254),0x19,slaveType,groupRange]; const payload=(slaveType===1?group8:group4).map(v=> (slaveType===1?clamp(v,0,0xff):clamp(v,0,0x0f))&0xff); const bytes=[...h,...payload]; const c=crc8(bytes,CRC_PARAMS); return [...bytes,c]},[selectedUnitId,slaveType,groupRange,group8,group4])
  const groupRead = useMemo(()=>{ const b=[clamp(selectedUnitId??0,0,254),0x17,slaveType,groupRange]; const c=crc8(b,CRC_PARAMS); return [...b,c]},[selectedUnitId,slaveType,groupRange])

  // Send 485 packets via TCP transparent host (selected host)
  async function send485(bytes:number[]){ if(!curHost) throw new Error('請先選取主機與從機'); const res = await window.api?.sendTcpHex?.(curHost.host, curHost.port, toHex(bytes)); if(!res?.ok) throw new Error(res?.error || 'send failed'); return spaced(res.data||'') }

  // Raw 發送功能已移除（依需求）

  // Snapshot import/export (manual, no persistence)
  function buildSnapshot(){ return { version:1, hosts: hosts.map(h=>({ name:h.name, host:h.host, port:h.port, slaves: h.slaves.map(s=>({unitId:s.unitId, typeValue:s.typeValue})) })) } }
  function validateSnap(obj:any){ if(!obj||typeof obj!=='object') return false; if(obj.version!==1) return false; if(!Array.isArray(obj.hosts)) return false; for(const h of obj.hosts){ if(!h||typeof h!=='object') return false; if(typeof h.name!=='string'||typeof h.host!=='string'||typeof h.port!=='number') return false; if(!Array.isArray(h.slaves)) return false; for(const s of h.slaves){ if(typeof s!=='object'||typeof s.unitId!=='number') return false; if(s.typeValue!=null && typeof s.typeValue!=='number') return false } } return true }
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
      const rebuilt:HostEntry[] = obj.hosts.map((h:any)=>({ id:`${h.host}:${h.port}:${Date.now()}-${Math.random().toString(36).slice(2,8)}`, name:h.name, host:h.host, port:h.port, tid:1, slaves:h.slaves.map((s:any)=>({unitId:s.unitId, typeValue:s.typeValue})) }));
      setHosts(rebuilt);
      setSelectedHostId(rebuilt[0]?.id||'');
      setSelectedUnitId(rebuilt[0]?.slaves[0]?.unitId ?? null);
    }catch(e:any){ alert('匯入失敗: '+(e?.message||e)) }
  }

  // ===== UI =====
  return (
    <div style={{ padding:24, background:'#f0f2f5', minHeight:'100vh' }}>
      <Space direction="vertical" size="large" style={{ width:'100%' }}>
        <Title level={2} style={{margin:0}}>Modbus 控制（單頁整合）</Title>

        <Row gutter={16}>
          {/* 左側 1/2：主機列表（含從機子表格） */}
          <Col span={12}>
            <Card title="主機與從機" bordered={false}>
              <Space wrap style={{ marginBottom:16 }}>
                <Input value={hostNameInput} onChange={e=>setHostNameInput(e.target.value)} placeholder="主機名稱" style={{ width:160 }} />
                <Input value={hostAddrInput} onChange={e=>setHostAddrInput(e.target.value)} placeholder="Host" style={{ width:160 }} />
                <InputNumber value={hostPortInput} onChange={v=>setHostPortInput(v||502)} placeholder="Port" style={{ width:120 }} min={1} max={65535} />
                <Button type="primary" icon={<PlusOutlined />} onClick={addHost}>新增主機</Button>
                <Button icon={<SaveOutlined />} onClick={exportToFile} disabled={!hosts.length}>匯出 JSON</Button>
                <Button icon={<FolderOpenOutlined />} onClick={importFromFile}>匯入 JSON</Button>
                {/* 快捷開關：群組/場景（TCP 直接寫入主機暫存器） */}
                <Space>
                  <Select
                    style={{width:160}}
                    placeholder="群組（選擇）"
                    value={quickGroupSel}
                    onChange={async (v)=>{ setQuickGroupSel(v); if(autoOffOnGroupSel){ await forceMaskOff() } }}
                    options={Array.from({length:32},(_,i)=>({ value:i+1, label:`群組 ${i+1}` }))}
                  />
                  <Switch
                    checked={quickGroupOn}
                    onChange={async (on)=>{ setQuickGroupOn(on); await quickSetGroup(on) }}
                    checkedChildren="開"
                    unCheckedChildren="關"
                  />
                  <Select
                    style={{width:180}}
                    placeholder="場景（選擇）"
                    value={quickSceneSel}
                    onChange={async (v)=>{ setQuickSceneSel(v); if(autoOffOnSceneSel){ await forceMaskOff() } }}
                    options={computeSceneOptions()}
                  />
                  <Switch
                    checked={quickSceneOn}
                    onChange={async (on)=>{ setQuickSceneOn(on); await quickSetScene(on) }}
                    checkedChildren="開"
                    unCheckedChildren="關"
                  />
                  <Button icon={<SettingOutlined />} onClick={()=> openTriggerConfig()}>
                    觸發設定
                  </Button>
                </Space>
              </Space>

              <Table<HostEntry>
                dataSource={hosts} 
                rowKey="id"
                pagination={false}
                size="small"
                locale={{ emptyText: '尚未新增主機' }}
                rowClassName={(h)=> h.id===selectedHostId? 'selected-row' : ''}
                expandable={{
                  expandedRowRender: (h: HostEntry) => {
                    const slaveColumns = [
                      { title: 'unitId', dataIndex: 'unitId', key: 'unitId', width: 80, render: (u:number) => <Text>U{u}</Text> },
                      { title: '名稱', dataIndex: 'name', key: 'name', width: 140, render: (n:string|undefined) => n? <Text>{n}</Text> : <Text type="secondary">未命名</Text> },
                      { title: '類型', dataIndex: 'typeValue', key: 'typeValue', width: 120, render: (v:number|null) => v===1? '1 (SW8CH)' : v===2? '2 (4CH)' : '-' },
                      { title: '操作', key: 'act', render: (_:any, s: SlaveEntry) => (
                        <Space>
                          <Button size="small" onClick={async()=>{ 
                            setSelectedHostId(h.id); 
                            setSelectedUnitId(s.unitId);
                            if(s.typeValue!=null){
                              await syncByType(h, s.unitId, s.typeValue)
                            } else {
                              setSyncing(true) // 等使用者在右側選定類型後會自動同步
                            }
                          }}>選擇</Button>
                          <Button size="small" onClick={()=>{
                            Modal.confirm({
                              title: `編輯從機 U${s.unitId}`,
                              content: (
                                <Space direction="vertical" style={{width:'100%'}}>
                                  <Input placeholder="名稱" defaultValue={s.name} id={`edit-slave-name-${h.id}-${s.unitId}`} />
                                  <InputNumber min={0} max={254} placeholder="站號 (unitId)" defaultValue={s.unitId} id={`edit-slave-unit-${h.id}-${s.unitId}`} style={{width:'100%'}} />
                                </Space>
                              ),
                              onOk: ()=>{
                                const nameEl = document.getElementById(`edit-slave-name-${h.id}-${s.unitId}`) as HTMLInputElement
                                const unitEl = document.getElementById(`edit-slave-unit-${h.id}-${s.unitId}`) as HTMLInputElement
                                const newName = (nameEl?.value||'').trim()
                                const newUnit = clamp(Number((unitEl as any)?.value ?? s.unitId), 0, 254)
                                // 檢查重複（排除自身）
                                const dup = h.slaves.some(ss=> ss.unitId===newUnit && ss.unitId!==s.unitId)
                                if(dup){ message.error('該站號已存在'); return Promise.reject() as any }
                                setHosts(list=> list.map(x=> {
                                  if(x.id!==h.id) return x
                                  const updated = x.slaves.map(ss=> ss.unitId===s.unitId? { ...ss, unitId:newUnit, name: newName } : ss)
                                  const sorted = updated.sort((a,b)=> a.unitId-b.unitId)
                                  return { ...x, slaves: sorted }
                                }))
                                // 若目前選中的是此從機，且站號有變，更新選取
                                if(selectedHostId===h.id && selectedUnitId===s.unitId){ setSelectedUnitId(newUnit) }
                              }
                            })
                          }}>編輯</Button>
                          <Button size="small" danger onClick={()=> deleteSlave(h, s.unitId)}>刪除</Button>
                        </Space>
                      )}
                    ]
                    return (
                      <div style={{ padding:8, background:'#fafafa' }}>
                        {/* 內層新增從機按鈕已移除（改由主機列操作區新增） */}
                        <Table<SlaveEntry> 
                          dataSource={h.slaves} 
                          columns={slaveColumns as any} 
                          rowKey="unitId" 
                          size="small" 
                          pagination={false}
                          rowClassName={(s)=> (h.id===selectedHostId && s.unitId===selectedUnitId)? 'selected-row' : ''}
                        />
                      </div>
                    )
                  }
                }}
                columns={[
                  { title: '主機', dataIndex: 'name', key: 'name', width: 140, render: (name) => <Text strong>{name}</Text> },
                  { title: '位址', key: 'address', width: 150, render: (_:any,h:HostEntry) => `${h.host}:${h.port}` },
                  { title: '連線', key: 'connection', width: 200, render: (_:any,h:HostEntry) => (
                    <Space>
                      <Button size="small" icon={<ApiOutlined />} onClick={()=>connectHost(h)} loading={connMap[h.id]==='connecting'}>
                        連線
                      </Button>
                      <Tag color={connMap[h.id]==='ok'?'success': connMap[h.id]==='fail'?'error':'default'}>
                        {connMap[h.id]==='connecting'?'連線中…': connMap[h.id]==='ok'?'已連線': connMap[h.id]==='fail'?'失敗':'未連線'}
                      </Tag>
                    </Space>
                  )},
                  { title: '操作', key: 'actions', width: 420, render: (_:any,h:HostEntry) => (
                    <Space>
                      <Tooltip title="新增從機"><Button size="small" icon={<PlusOutlined />} onClick={()=>{
                        Modal.confirm({
                          title: '新增從機',
                          content: (
                            <Space direction="vertical" style={{width:'100%'}}>
                              <Input placeholder="名稱（選填）" id={`slaveNameInput-top-${h.id}`} />
                              <InputNumber min={0} max={254} placeholder="輸入 unitId" id={`unitIdInput-top-${h.id}`} style={{width:'100%'}} />
                            </Space>
                          ),
                          onOk: () => {
                            const input = document.getElementById(`unitIdInput-top-${h.id}`) as HTMLInputElement;
                            const nameEl = document.getElementById(`slaveNameInput-top-${h.id}`) as HTMLInputElement;
                            const v = Number(input?.value);
                            const nm = (nameEl?.value||'').trim();
                            if(isNaN(v)) { message.error('請輸入有效的站號'); return }
                            if(h.slaves.some(s=> s.unitId===v)) { message.error('該站號已存在'); return }
                            addSlave(h, v, nm);
                          }
                        })
                      }}/></Tooltip>
                      <Tooltip title="編輯主機"><Button size="small" icon={<EditOutlined />} onClick={()=>{
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
                      <Button size="small" onClick={()=> openMapModal(h)}>群組/場景對應</Button>
                    </Space>
                  )}
                ]}
              />
            </Card>
          </Col>

          {/* 右側 1/2：操作面板 */}
          <Col span={12}>
            <Card 
              title="操作面板" 
              bordered={false}
              extra={<Text type="secondary">目前選擇：{curHost? `${curHost.name} (${curHost.host}:${curHost.port})` : '—'} / unitId={selectedUnitId ?? '—'}</Text>}
            >
        {!curHost || selectedUnitId==null ? (
          <Text type="secondary">請先於主機區選擇一個從機</Text>
        ) : (
          <Space direction="vertical" size="middle" style={{width:'100%'}}>
            <Title level={3} style={{margin:0}}>
              {curHost? `${curHost.name} (${curHost.host}:${curHost.port})` : '未選擇主機'}
              {selectedUnitId!=null ? ` / U${selectedUnitId}${curSlave?.name? ` - ${curSlave.name}`:''}` : ' / 未選擇從機'}
            </Title>
            {/* Type registration + Mask (combined) */}
            <Card type="inner" title="設備註冊（FC03 / FC06 位址 12000 + unitId）" size="small">
              <Space direction="vertical" style={{ width:'100%' }} size="small">
                {/* 類型註冊 */}
                <Space wrap>
                  <Space>
                    <Text>類型:</Text>
                    <Select 
                      style={{ width:150 }} 
                      value={curSlave?.typeValue ?? undefined} 
                      placeholder="選擇類型"
                      onChange={async v=> { 
                        setSyncing(true)
                        await writeType(curHost, selectedUnitId!, v)
                        await syncByType(curHost, selectedUnitId!, v)
                      }}
                      options={[
                        {value:1, label:'1 (SW8CH)'},
                        {value:2, label:'2 (4CH)'}
                      ]}
                    />
                  </Space>
                  {/* 4CH 時同時顯示兩顆按鈕，FC03 在『讀取 4CH 調光值』右側；其他型別僅顯示 FC03 */}
                  {curSlave?.typeValue===2 ? (
                    <>
                      <Button onClick={()=>readDimmingAll(curHost, selectedUnitId)}>讀取 4CH 調光值</Button>
                      <Button onClick={()=>readType(curHost, selectedUnitId)}>讀取 FC03</Button>
                    </>
                  ) : (
                    <Button onClick={()=> readMask(curHost, selectedUnitId)}>讀取 FC03</Button>
                  )}
                  {syncing && <Text type="secondary">同步中…</Text>}
                </Space>
                {/* PDU 預覽移除 */}

                {/* 單寄存器遮罩（合併進同卡片；以燈號 icon 呈現） */}
                <div style={{ marginTop:12 }}>

                  {/* SW8：8 顆燈，點擊即時計算 mask 並送出 FC06 */}
                  {curSlave?.typeValue===1 && (
                    <Row gutter={[8,8]} style={{ marginTop:8, filter: syncing? 'grayscale(30%)': undefined, opacity: syncing? 0.85: 1 }}>
                      {Array.from({length:8}).map((_,i)=>{
                        const on = ((maskValue>>i)&1)===1;
                        const color = on? '#fadb14' : '#d9d9d9';
                        const glow = on? '0 0 8px rgba(250,219,20,0.9), 0 0 16px rgba(250,219,20,0.6)' : 'none';
                        return (
                          <Col span={3} key={i}>
                            <Space direction="vertical" size={0} style={{width:'100%', alignItems:'center'}}>
                              <BulbFilled style={{ fontSize:32, color, textShadow: glow as any, cursor:'pointer' }}
                                onClick={async()=>{
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
                              <Text type="secondary" style={{fontSize:12}}>CH{i+1}</Text>
                            </Space>
                          </Col>
                        )
                      })}
                    </Row>
                  )}

                  {/* 4CH：4 顆燈 + 亮度滑桿；使用 Modbus TCP 直接寫入調光暫存器（5000 起） */}
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
                              <div style={{display:'flex', justifyContent:'center'}}>
                                <BulbFilled style={{ fontSize:36, color, textShadow: glow as any, cursor:'pointer' }}
                                  onClick={async()=>{
                                    const unit = selectedUnitId as number
                                    // 清除任何既有延遲讀取
                                    const timers = delayedReadTimersRef.current
                                    if(timers[i]){ window.clearTimeout(timers[i]); timers[i]=0 }
                                    // 切換遮罩位元（UI 先樂觀更新）
                                    const prev = maskValue
                                    const newMask = !on ? ((prev | (1<<i)) & 0x0f) : ((prev & ~(1<<i)) & 0x0f)
                                    setMaskValue(newMask)
                                    try{
                                      await writeMask(curHost, unit, newMask)
                                    }catch(e){
                                      setMaskValue(prev)
                                      message.error('遮罩寫入失敗')
                                    }
                                    // 每次點擊後皆立即讀取：狀態(遮罩) 與 該通道調光值
                                    try{ await readMask(curHost, unit) }catch{}
                                    const willOn = !on
                                    if(willOn){
                                      // 開啟：立即讀取該通道調光值
                                      try{
                                        const v = await readDimmingOne(curHost, unit, i)
                                        setBrightness4(prevB=> prevB.map((vv,idx)=> idx===i? v: vv))
                                      }catch{}
                                    }else{
                                      // 關閉：延遲 1 秒後再讀取該通道調光值
                                      timers[i] = window.setTimeout(async()=>{
                                        try{
                                          const v = await readDimmingOne(curHost, unit, i)
                                          setBrightness4(prevB=> prevB.map((vv,idx)=> idx===i? v: vv))
                                        }catch{}
                                      }, 1000)
                                      delayedReadTimersRef.current = timers
                                    }
                                  }}
                                />
                              </div>
                              <Slider min={0} max={255} value={val}
                                onChange={(v)=>{
                                  const n = Number(v)||0;
                                  setBrightness4(brightness4.map((vv,idx)=> idx===i? n: vv));
                                }}
                                onAfterChange={async(v)=>{
                                  const n = Number(v)||0;
                                  await writeDimming(curHost, selectedUnitId, i, n);
                                }}
                              />
                              <div style={{display:'flex', justifyContent:'center'}}>
                                <Space size={6} align="center">
                                  <Input size="small" value={chNames[i]}
                                    onChange={(e)=>{
                                      const name = e.target.value
                                      setChNamesByUnit(prev=>{
                                        const arr = (prev[unit]?.slice() || ['CH1','CH2','CH3','CH4'])
                                        arr[i] = name
                                        return { ...prev, [unit]: arr }
                                      })
                                    }}
                                    style={{ width:90, textAlign:'center' }}
                                  />
                                  <Text type="secondary" style={{fontSize:12}}>（{val}）</Text>
                                </Space>
                              </div>
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

            {/* 485 Scenes */}
            <Card type="inner" title="場景（0x1A/0x18）" size="small">
              <Space wrap style={{marginBottom:12}}>
                <Space>
                  <Text>Type:</Text>
                  <Select value={slaveType} onChange={v=> setSlaveType(v)} style={{width:100}} options={[{value:1,label:'8CH'},{value:2,label:'4CH'}]} />
                </Space>
                <Space>
                  <Text>Range:</Text>
                  <Select value={sceneRange} onChange={v=> setSceneRange(v)} style={{width:100}} options={[{value:1,label:'1..16'},{value:2,label:'17..32'},{value:3,label:'33..48'},{value:4,label:'49..64'}]} />
                </Space>
                <Checkbox checked={enableLow} onChange={e=>setEnableLow(e.target.checked)}>啟用 1..8</Checkbox>
                <Checkbox checked={enableHigh} onChange={e=>setEnableHigh(e.target.checked)}>啟用 9..16</Checkbox>
              </Space>
              {slaveType===1 ? (
                <Row gutter={[8,8]}>
                  {scene8.map((v,i)=> (
                    <Col span={3} key={i}>
                      <Space direction="vertical" size={0} style={{width:'100%'}}>
                        <Text type="secondary" style={{fontSize:12}}>S{i+1}</Text>
                        <InputNumber min={0} max={255} value={v} onChange={val=> setScene8(prev=> prev.map((vv,idx)=> idx===i? (val||0): vv))} style={{width:'100%'}} size="small" />
                      </Space>
                    </Col>
                  ))}
                </Row>
              ) : (
                <Space direction="vertical" size={8} style={{width:'100%'}}>
                  {scene4.map((row,i)=> (
                    <Row key={i} gutter={8} align="middle">
                      <Col span={2}><Text type="secondary">S{i+1}</Text></Col>
                      {row.map((v,ch)=> (
                        <Col span={5} key={ch}>
                          <Slider min={0} max={255} value={v} onChange={val=> setScene4(prev=> prev.map((r,idx)=> idx===i? r.map((vv,j)=> j===ch? val: vv) : r))} />
                        </Col>
                      ))}
                    </Row>
                  ))}
                </Space>
              )}
              <Space wrap style={{marginTop:12}}>
                <Button onClick={async()=>{ const r= await send485(sceneWrite); emitLog('SCENE-W', toHexSp(sceneWrite), r) }}>送出 0x1A</Button>
                <Button onClick={async()=>{ const r= await send485(sceneRead);  emitLog('SCENE-R', toHexSp(sceneRead), r) }}>讀出 0x18</Button>
                <Text code style={{fontSize:12}}>{toHexSp(sceneWrite)}</Text>
              </Space>
            </Card>

            {/* 485 Groups */}
            <Card type="inner" title="群組（0x19/0x17）" size="small">
              <Space wrap style={{marginBottom:12}}>
                <Space>
                  <Text>Type:</Text>
                  <Select value={slaveType} onChange={v=> setSlaveType(v)} style={{width:100}} options={[{value:1,label:'8CH'},{value:2,label:'4CH'}]} />
                </Space>
                <Space>
                  <Text>Range:</Text>
                  <Select value={groupRange} onChange={v=> setGroupRange(v)} style={{width:100}} options={[{value:1,label:'1..16'},{value:2,label:'17..32'}]} />
                </Space>
              </Space>
              {slaveType===1 ? (
                <Row gutter={[8,8]}>
                  {group8.map((v,i)=> (
                    <Col span={3} key={i}>
                      <Space direction="vertical" size={0} style={{width:'100%'}}>
                        <Text type="secondary" style={{fontSize:12}}>G{i+1}</Text>
                        <InputNumber min={0} max={255} value={v} onChange={val=> setGroup8(prev=> prev.map((vv,idx)=> idx===i? (val||0): vv))} style={{width:'100%'}} size="small" />
                      </Space>
                    </Col>
                  ))}
                </Row>
              ) : (
                <Row gutter={[8,8]}>
                  {group4.map((v,i)=> (
                    <Col span={3} key={i}>
                      <Space direction="vertical" size={0} style={{width:'100%'}}>
                        <Text type="secondary" style={{fontSize:12}}>G{i+1}</Text>
                        <Slider min={0} max={15} value={v} onChange={val=> setGroup4(prev=> prev.map((vv,idx)=> idx===i? val: vv))} />
                        <Text style={{fontSize:12,textAlign:'center'}}>{v}</Text>
                      </Space>
                    </Col>
                  ))}
                </Row>
              )}
              <Space wrap style={{marginTop:12}}>
                <Button onClick={async()=>{ const r= await send485(groupWrite); emitLog('GROUP-W', toHexSp(groupWrite), r) }}>送出 0x19</Button>
                <Button onClick={async()=>{ const r= await send485(groupRead);  emitLog('GROUP-R', toHexSp(groupRead), r) }}>讀出 0x17</Button>
                <Text code style={{fontSize:12}}>{toHexSp(groupWrite)}</Text>
              </Space>
            </Card>

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
        width={760}
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
                // 以 rows 直接寫入（0-based）
                await writeMappingRows(h, mapRows)
                // 名稱本地保存
                const names = Array(48).fill('')
                for(const r of mapRows){ if(r.scene>=1 && r.scene<=48) names[r.scene-1] = r.name||'' }
                setMappingNamesByHost(prev=> ({ ...prev, [h.id]: names }))
              }}>儲存</Button>
              <Button size="small" onClick={addMapRow}>新增一列</Button>
            </Space>
            <Table
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={mapRows}
              columns={[
                { title:'場景名稱', dataIndex:'name', render:(v:any, r:MappingRow)=> r.editing? (
                  <Input value={r.name} onChange={e=> updateMapRow(r.key, { name: e.target.value })} />
                ) : (<span>{r.name||'-'}</span>) },
                { title:'場景', dataIndex:'scene', width:120, render:(v:any, r:MappingRow)=> r.editing? (
                  <Select value={r.scene} style={{width:100}} onChange={val=> updateMapRow(r.key, { scene: val })} options={Array.from({length:48},(_,i)=>({ value:i+1, label:`${i+1}` }))} />
                ) : (<span>{r.scene}</span>) },
                { title:'對應群組', dataIndex:'group', width:160, render:(v:any, r:MappingRow)=> r.editing? (
                  <Select value={r.group} style={{width:140}} onChange={val=> updateMapRow(r.key, { group: val })} options={[{value:0,label:'未設定'}, ...Array.from({length:32},(_,i)=>({ value:i+1, label:`群組 ${i+1}` }))]} />
                ) : (<span>{r.group>0? `群組 ${r.group}` : '未設定'}</span>) },
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
    </div>
  )
}
