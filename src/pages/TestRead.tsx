import { useMemo, useState } from 'react'
import { Card, Space, Select, InputNumber, Button, Typography, Input, Tag, message } from 'antd'

const { Text, Title } = Typography

// Local utilities (no persistence)
function toHex(bs: number[]) { return bs.map(b=>b.toString(16).padStart(2,'0')).join('') }
function toHexSp(bs: number[]) { return bs.map(b=>b.toString(16).padStart(2,'0')).join(' ') }
function spaced(hex: string) { return hex?.match(/.{1,2}/g)?.join(' ') || '' }
function clamp(n:number,lo:number,hi:number){ return Math.max(lo, Math.min(hi,n)) }
function numToBytes(num: number, bytes: number) { const arr:number[]=[]; for(let i=bytes-1;i>=0;i--) arr.push((num>>(i*8))&0xff); return arr }
function buildFC03(tid:number, unitId:number, addr:number, qty=1){ const pdu=[0x03, ...numToBytes(addr,2), ...numToBytes(qty,2)]; const len=pdu.length+1; const mbap=[...numToBytes(tid&0xffff,2), 0x00,0x00, ...numToBytes(len,2), unitId&0xff]; return [...mbap, ...pdu] }
function buildFC06(tid:number, unitId:number, addr:number, value:number){ const pdu=[0x06, ...numToBytes(addr,2), ...numToBytes(value,2)]; const len=pdu.length+1; const mbap=[...numToBytes(tid&0xffff,2), 0x00,0x00, ...numToBytes(len,2), unitId&0xff]; return [...mbap, ...pdu] }

// CRC-8 parameters (derived from samples)
type CRCParams = { poly:number; init:number; refin:boolean; refout:boolean; xorout:number }
const CRC8_CUSTOM: CRCParams = { poly:0x31, init:0xff, refin:false, refout:false, xorout:0x00 }
function reflect8(b:number){ let out=0; for(let i=0;i<8;i++) out=(out<<1)|((b>>i)&1); return out&0xff }
function crc8(bytes:number[], p:CRCParams){ let crc=p.init&0xff; for(let _b of bytes){ let b=_b; if(p.refin) b=reflect8(b); crc^=b; for(let i=0;i<8;i++) crc=(crc&0x80)?((crc<<1)^p.poly)&0xff: (crc<<1)&0xff } if(p.refout) crc=reflect8(crc); return (crc^p.xorout)&0xff }

export default function TestRead(){
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState<number>(5000)
  const [unitId, setUnitId] = useState<number>(25)
  const [slaveType, setSlaveType] = useState<1|2>(1)
  const [conn, setConn] = useState<'idle'|'connecting'|'ok'|'fail'>('idle')

  const [sceneRange, setSceneRange] = useState<1|2|3|4>(1)
  const [groupRange, setGroupRange] = useState<1|2>(1)

  const sceneRead = useMemo(()=>{ const b=[clamp(unitId,0,254),0x18,slaveType,sceneRange]; const c=crc8(b,CRC8_CUSTOM); return [...b,c]},[unitId,slaveType,sceneRange])
  const groupRead = useMemo(()=>{ const b=[clamp(unitId,0,254),0x17,slaveType,groupRange]; const c=crc8(b,CRC8_CUSTOM); return [...b,c]},[unitId,slaveType,groupRange])

  const [resp, setResp] = useState('')
  const [chunks, setChunks] = useState<string[]>([])
  const [raw, setRaw] = useState('')
  const [tid, setTid] = useState(1)
  // ===== USB-485 (Serial) =====
  const [serList, setSerList] = useState<Array<{ path:string; friendlyName?:string; manufacturer?:string }>>([])
  const [serPath, setSerPath] = useState<string>('')
  const [baud, setBaud] = useState<number>(9600)
  const [idleMs, setIdleMs] = useState<number>(80)
  const [serOpen, setSerOpen] = useState(false)
  const [serStatus, setSerStatus] = useState<'idle'|'open'|'close'|'error'>('idle')
  const [serMsg, setSerMsg] = useState('')
  const [serListData, setSerListData] = useState<Array<{ t:number; hex:string; len:number }>>([])
  // 傳輸方式：TCP 透明監視 or USB-485
  const [transport, setTransport] = useState<'tcp'|'serial'>('tcp')

  type Hist = { t:number; tag:string; tx:string; rx:string; chunks?:string[] }
  const [history, setHistory] = useState<Hist[]>([])

  const emitLog = (tag:string, tx:string, rx:string, cks?:string[]) => {
    try { window.dispatchEvent(new CustomEvent('modbus:log', { detail: { tag, tx, rx, t: Date.now() } })) } catch {}
    setHistory(prev => [{ t:Date.now(), tag, tx, rx, chunks:cks }, ...prev].slice(0,200))
  }

  // Serial subscriptions
  useMemo(()=>{
    const offData = window.api?.onSerialData?.((e)=>{
      if(e.path!==serPath) return
      setSerListData(prev=> [{ t:e.t, hex:e.hex, len:e.len }, ...prev].slice(0,500))
    })
    const offStatus = window.api?.onSerialStatus?.((e)=>{
      if(e.path!==serPath) return
      setSerStatus(e.status); setSerMsg(e.message||''); setSerOpen(e.status==='open')
    })
    return ()=>{ try{ offData?.() }catch{}; try{ offStatus?.() }catch{} }
  }, [serPath])

  async function refreshSerial(){ const res = await window.api?.serialList?.(); if(res?.ok) setSerList(res.ports||[]) }
  async function openSerial(){
    if(!serPath) return;
    const r = await window.api?.serialOpen?.(serPath, baud);
    if(!r?.ok) { setSerStatus('error'); setSerMsg(r?.error||'open failed'); return }
    // 設定空閒分幀時間（避免分段）
    await window.api?.serialSetIdle?.(serPath, idleMs)
  }
  async function closeSerial(){ if(!serPath) return; await window.api?.serialClose?.(serPath); }
  async function serialSend(hex:string){
    if(!serOpen||!serPath) return;
    const clean = (hex||'').replace(/[^0-9a-fA-F\s]/g,'').replace(/\s+/g,'').trim()
    if(!clean || clean.length%2!==0){ message.error('HEX 格式不正確'); return }
    await window.api?.serialWrite?.(serPath, clean)
  }

  // Monitor state
  const [monRunning, setMonRunning] = useState(false)
  const [monList, setMonList] = useState<Array<{ t:number; hex:string; len:number; dir:'RX'|'TX' }>>([])
  const [monStatus, setMonStatus] = useState<'idle'|'open'|'close'|'error'>('idle')
  const [monMsg, setMonMsg] = useState('')
  // Subscribe to monitor events
  useMemo(() => {
    const offData = window.api?.onMonitorData?.((e) => {
      setMonList(prev => [{ t:e.t, hex: e.hex, len: e.len, dir:'RX' as const }, ...prev].slice(0,500))
    })
    const offTx = window.api?.onMonitorTx?.((e) => {
      setMonList(prev => [{ t:e.t, hex: e.hex, len: e.len, dir:'TX' as const }, ...prev].slice(0,500))
    })
    const offStatus = window.api?.onMonitorStatus?.((e) => {
      setMonStatus(e.status); setMonMsg(e.message||'')
    })
    return () => { try { offData?.() } catch {}; try { offTx?.() } catch {}; try { offStatus?.() } catch {} }
  }, [])

  async function ensureMonitor() {
    if (!monRunning) {
      const r = await window.api?.monitorStart?.(host, port)
      if (r?.ok) { setMonRunning(true); setMonList([]); setMonStatus('open'); setMonMsg('') }
      else { setMonStatus('error'); setMonMsg(r?.error||'monitor start failed') }
    }
  }

  async function send(bytes:number[]){
    const hex = toHex(bytes)
    await ensureMonitor()
    const r = await window.api?.monitorWrite?.(host, port, hex)
    if(!r?.ok){ setMonMsg(r?.error||'monitor not running'); setMonStatus('error'); emitLog('MON-TX', spaced(hex), ''); return }
    emitLog('MON-TX', spaced(hex), '')
  }

  async function sendByTransport(bytes:number[]){
    const hex = toHex(bytes)
    if(transport==='serial'){
      if(!serOpen || !serPath){ message.error('請先開啟 USB-485 埠'); return }
      await serialSend(hex)
      emitLog('SER-TX', spaced(hex), '')
    }else{
      await send(bytes)
    }
  }

  async function sendRaw(){
    const clean = raw.replace(/[^0-9a-fA-F\s]/g,'').replace(/\s+/g,'').trim()
    if(!clean || clean.length%2!==0) return
    await ensureMonitor()
    const r = await window.api?.monitorWrite?.(host, port, clean)
    if(!r?.ok){ setMonMsg(r?.error||'monitor not running'); setMonStatus('error'); return }
    emitLog('MON-TX', spaced(clean), '')
  }

  // FC03/FC06 simple sender (Modbus TCP with MBAP)
  const [fcAddr, setFcAddr] = useState<number>(2000)
  const [fcQty, setFcQty] = useState<number>(1)
  const [fcVal, setFcVal] = useState<number>(0)
  async function sendFC03(){ const next=(tid+1)&0xffff; setTid(next); const pkt=buildFC03(next||1, unitId, fcAddr, fcQty); const hex=toHex(pkt); const r= await window.api?.sendTcpHex?.(host, port, hex); if(r?.ok){ const rx=spaced(r.data||''); setResp(rx); setChunks(r.chunks||[]); emitLog('FC03', spaced(hex), rx, r.chunks) } else { const er=r?.error||'error'; setResp(er); setChunks([]); emitLog('FC03', spaced(hex), er) } }
  async function sendFC06(){ const next=(tid+1)&0xffff; setTid(next); const pkt=buildFC06(next||1, unitId, fcAddr, fcVal); const hex=toHex(pkt); const r= await window.api?.sendTcpHex?.(host, port, hex); if(r?.ok){ const rx=spaced(r.data||''); setResp(rx); setChunks(r.chunks||[]); emitLog('FC06', spaced(hex), rx, r.chunks) } else { const er=r?.error||'error'; setResp(er); setChunks([]); emitLog('FC06', spaced(hex), er) } }

  return (
    <div style={{ padding:16 }}>
      <Title level={3} style={{marginTop:0}}>讀取測試（場景/群組）</Title>
      <Space direction="vertical" size="large" style={{ width:'100%' }}>
        <Card title="USB-485 (Serial)" size="small">
          <Space wrap>
            <Button onClick={refreshSerial}>刷新埠</Button>
            <Select 
              style={{width:280}}
              placeholder="選擇序列埠"
              value={serPath||undefined}
              onChange={v=> setSerPath(v)}
              options={serList.map(p=>({ value:p.path, label:`${p.path}${p.friendlyName? ' - '+p.friendlyName:''}` }))}
            />
            <span>Baud</span>
            <InputNumber value={baud} min={1200} max={921600} step={300} onChange={v=> setBaud(v||9600)} />
            <span>Idle(ms)</span>
            <InputNumber value={idleMs} min={5} max={1000} step={5} onChange={async v=>{ const n=v||80; setIdleMs(n); if(serOpen && serPath) await window.api?.serialSetIdle?.(serPath, n) }} />
            <Button type={serOpen? 'default':'primary'} onClick={serOpen? closeSerial: openSerial}>{serOpen? '關閉' : '開啟'}</Button>
            <Tag color={serStatus==='open'?'success': serStatus==='error'?'error':'default'}>{serStatus==='idle'?'idle': serStatus}</Tag>
            {serMsg && <span style={{color:'#64748b', fontSize:12}}>{serMsg}</span>}
          </Space>
          <div style={{marginTop:8, maxHeight:180, overflow:'auto', border:'1px solid #e5e7eb', borderRadius:6, padding:8}}>
            {serListData.length===0 ? <Text type="secondary">尚無資料</Text> : (
              <div style={{display:'grid', gap:6}}>
                {serListData.map((m,idx)=> (
                  <div key={idx} style={{display:'flex', gap:8}}>
                    <span style={{color:'#94a3b8', fontSize:12}}>{new Date(m.t).toLocaleTimeString()}</span>
                    <Tag>RX</Tag>
                    <code>{spaced(m.hex)}</code>
                    <span style={{color:'#94a3b8', fontSize:12}}>[{m.len}B]</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Space style={{marginTop:8}}>
            <Input placeholder="HEX（例如：0a 17 01 01 4e）" value={raw} onChange={e=>setRaw(e.target.value)} style={{width:360}} />
            <Button type="primary" onClick={()=> serialSend(raw)}>送出 HEX</Button>
          </Space>
        </Card>
        <Card title="連線設定" size="small">
          <Space wrap>
            <span>Host</span>
            <Input value={host} onChange={e=>setHost(e.target.value)} style={{width:160}} />
            <span>Port</span>
            <InputNumber value={port} min={1} max={65535} onChange={v=>setPort(v||502)} />
            <span>unitId</span>
            <InputNumber value={unitId} min={0} max={254} onChange={v=>setUnitId(v||0)} />
            <span>Type</span>
            <Select value={slaveType} onChange={v=>setSlaveType(v)} style={{width:120}} options={[{value:1,label:'8CH'},{value:2,label:'4CH'}]} />
            <Button onClick={async()=>{
              try{ setConn('connecting'); const r= await window.api?.connectHost?.(host, port); setConn(r?.ok?'ok':'fail') }
              catch{ setConn('fail') }
            }}>連線</Button>
            <Tag color={conn==='ok'?'success': conn==='fail'?'error': conn==='connecting'?'processing':'default'}>
              {conn==='connecting'?'連線中…': conn==='ok'?'已連線': conn==='fail'?'失敗':'未連線'}
            </Tag>
          </Space>
        </Card>

        <Card title="場景讀取 (0x18)" size="small">
          <Space wrap>
            <span>傳輸</span>
            <Select value={transport} onChange={v=> setTransport(v)} style={{width:140}} options={[{value:'tcp',label:'TCP 透明監視'},{value:'serial',label:'USB-485'}]} />
            <span>Range</span>
            <Select value={sceneRange} onChange={v=>setSceneRange(v)} style={{width:160}} options={[{value:1,label:'1..16'},{value:2,label:'17..32'},{value:3,label:'33..48'},{value:4,label:'49..64'}]} />
            <Button type="primary" onClick={()=>sendByTransport(sceneRead)}>讀取</Button>
            <Text code>{toHexSp(sceneRead)}</Text>
          </Space>
        </Card>

        <Card title="群組讀取 (0x17)" size="small">
          <Space wrap>
            <span>Range</span>
            <Select value={groupRange} onChange={v=>setGroupRange(v)} style={{width:160}} options={[{value:1,label:'1..16'},{value:2,label:'17..32'}]} />
            <Button type="primary" onClick={()=>sendByTransport(groupRead)}>讀取</Button>
            <Text code>{toHexSp(groupRead)}</Text>
          </Space>
        </Card>

        <Card title="原生發送（走監視通道）" size="small">
          <Space direction="vertical" style={{width:'100%'}}>
            <Input.TextArea value={raw} onChange={e=>setRaw(e.target.value)} placeholder="0a 17 01 01 4e" rows={3} />
            <Space>
              <Button type="primary" onClick={sendRaw}>用監視通道送出</Button>
            </Space>
          </Space>
        </Card>

        <Card title="透明通道監視（持續）" size="small">
          <Space wrap>
            <Button type={monRunning? 'default':'primary'} onClick={async()=>{ if(monRunning){ await window.api?.monitorStop?.(host, port); setMonRunning(false) } else { const r= await window.api?.monitorStart?.(host, port); if(r?.ok){ setMonRunning(true); setMonList([]) } } }}> {monRunning? '停止監視' : '開始監視'} </Button>
            <Tag color={monStatus==='open'?'success': monStatus==='error'?'error': monStatus==='close'?'default':'default'}>{monStatus==='idle'?'idle': monStatus}</Tag>
            {monMsg && <span style={{color:'#64748b', fontSize:12}}>{monMsg}</span>}
          </Space>
          <div style={{marginTop:8, maxHeight:200, overflow:'auto', border:'1px solid #e5e7eb', borderRadius:6, padding:8}}>
            {monList.length===0 ? <Text type="secondary">尚無監視資料</Text> : (
              <div style={{display:'grid', gap:6}}>
                {monList.map((m,idx)=> (
                  <div key={idx} style={{display:'flex', gap:8}}>
                    <span style={{color:'#94a3b8', fontSize:12}}>{new Date(m.t).toLocaleTimeString()}</span>
                    <Tag color={m.dir==='TX'?'processing':'default'}>{m.dir}</Tag>
                    <code>{spaced(m.hex)}</code>
                    <span style={{color:'#94a3b8', fontSize:12}}>[{m.len}B]</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card title="FC03 / FC06（Modbus TCP）" size="small">
          <Space wrap>
            <span>Address</span>
            <InputNumber value={fcAddr} min={0} max={65535} onChange={v=>setFcAddr(v||0)} />
            <span>Qty</span>
            <InputNumber value={fcQty} min={1} max={125} onChange={v=>setFcQty(v||1)} />
            <span>Value</span>
            <InputNumber value={fcVal} min={0} max={65535} onChange={v=>setFcVal(v||0)} />
            <Button onClick={sendFC03}>送 FC03</Button>
            <Button onClick={sendFC06}>送 FC06</Button>
          </Space>
          <div style={{marginTop:8}}>
            <Text type="secondary" style={{fontSize:12}}>TID: {tid}</Text>
          </div>
        </Card>

        <Card title="回應" size="small">
          <Text type="secondary">自訂 485 回覆請於上方「透明通道監視」查看（已標註 RX/TX）。</Text>
        </Card>

        <Card title="封包歷史（本頁）" size="small">
          {history.length===0 ? <Text type="secondary">尚無紀錄</Text> : (
            <div style={{display:'grid', gap:8}}>
              {history.map((h,idx)=>{
                const ts = new Date(h.t).toLocaleTimeString()
                return (
                  <div key={idx} style={{border:'1px solid #e5e7eb', borderRadius:6, padding:8}}>
                    <div style={{display:'flex', gap:8, alignItems:'center'}}>
                      <Tag>{h.tag}</Tag>
                      <span style={{color:'#64748b', fontSize:12}}>{ts}</span>
                    </div>
                    <div style={{marginTop:4}}><Text type="secondary">TX</Text><br/><code style={{display:'block'}}>{h.tx}</code></div>
                    <div style={{marginTop:4}}><Text type="secondary">RX</Text><br/><code style={{display:'block'}}>{h.rx}</code></div>
                    {h.chunks?.length ? (
                      <div style={{marginTop:6}}>
                        <Text type="secondary">chunks ({h.chunks.length})</Text>
                        <div style={{display:'grid', gap:4, marginTop:4}}>
                          {h.chunks.map((c,i)=>(<code key={i} style={{display:'block'}}>{c}</code>))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </Space>
    </div>
  )
}
