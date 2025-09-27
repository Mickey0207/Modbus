import React, { useMemo, useRef, useState } from 'react'
import { Button, Input, NumberInput, Select, TextBlock } from '@/components'
import { listSerialPorts, captureSerial } from '@/api/serial/spy'

type PortInfo = { path: string; manufacturer?: string }

function hexSanitize(input: string) {
  return input
    .replace(/[^0-9a-fA-F\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hexSanitize(hex).replace(/\s/g, '')
  if (clean.length % 2 !== 0) throw new Error('Hex 長度必須是偶數')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) out[i / 2] = parseInt(clean.slice(i, i + 2), 16)
  return out
}

function reflect8(x: number) {
  let r = 0
  for (let i = 0; i < 8; i++) r = (r << 1) | ((x >> i) & 1)
  return r & 0xFF
}
function crc8Generic(data: number[], poly: number, init: number, refin: boolean, refout: boolean, xorout: number) {
  let crc = init & 0xFF
  for (let b of data) {
    if (refin) b = reflect8(b)
    crc ^= b
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x80) ? (((crc << 1) & 0xFF) ^ (poly & 0xFF)) : ((crc << 1) & 0xFF)
    }
  }
  if (refout) crc = reflect8(crc)
  crc = (crc ^ xorout) & 0xFF
  return crc
}
function computeCustomCRC8(data: number[]) { return crc8Generic(data, 0x31, 0x00, false, false, 0x9F) }

export default function SerialSpy() {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [path, setPath] = useState('')
  const [baudRate, setBaudRate] = useState(9600)
  const [dataBits, setDataBits] = useState(8)
  const [stopBits, setStopBits] = useState(1)
  const [parity, setParity] = useState<'none'|'even'|'odd'>('none')
  const [durationMs, setDurationMs] = useState(1000)
  const [captureHex, setCaptureHex] = useState('')
  const [captureBytes, setCaptureBytes] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const [streaming, setStreaming] = useState(false)
  const [streamLog, setStreamLog] = useState('')
  const [streamBytes, setStreamBytes] = useState(0)
  const esRef = useRef<EventSource | null>(null)
  
  // 離開頁面時自動關閉串流
  React.useEffect(() => {
    return () => {
      try { esRef.current?.close() } catch {}
    }
  }, [])


  const baudOptions = useMemo(() => [9600, 19200, 38400, 57600, 115200], [])

  async function refreshPorts() {
    setLoading(true); setError(null)
    try {
      const res = await listSerialPorts()
      if (res.success && Array.isArray(res.data)) {
        setPorts(res.data as any)
        if (!path && res.data.length) setPath(res.data[0].path)
      } else setError(res.message || '列出序列阜失敗')
    } catch (e: any) { setError(e?.message || '列出序列阜時發生錯誤') }
    finally { setLoading(false) }
  }

  async function handleCapture() {
    if (!path) return setError('請先選擇序列阜')
    setError(null); setCaptureHex(''); setCaptureBytes(0)
    try {
      const res = await captureSerial({ path, baudRate, dataBits, stopBits, parity, durationMs })
      if (!res.success || !res.data) throw new Error(res.message || '擷取失敗')
      setCaptureHex(res.data.hex); setCaptureBytes(res.data.bytes)
    } catch (e: any) { setError(e?.message || '擷取時發生錯誤') }
  }

  const crcPreview = useMemo(() => {
    try {
      const bytes = Array.from(hexToBytes(streamLog.split(/\s+/).filter(Boolean).join(' ')))
      if (bytes.length === 0) return ''
      const v = computeCustomCRC8(bytes.slice(0, -1))
      return v.toString(16).toUpperCase().padStart(2, '0')
    } catch { return '' }
  }, [streamLog])

  function startStream() {
    if (!path) return setError('請先選擇序列阜')
    setError(null); setStreaming(true); setStreamLog(''); setStreamBytes(0)
    const params = new URLSearchParams({ path, baudRate: String(baudRate), dataBits: String(dataBits), stopBits: String(stopBits), parity })
    const es = new EventSource(`/api/serialspy/stream?${params.toString()}`)
    esRef.current = es
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'start') {
          setStreamLog((s) => s + `[start] ${new Date(msg.ts).toLocaleString()} 開始監聽 ${msg.path} ${msg.baudRate}-${msg.dataBits}-${msg.stopBits} ${msg.parity}\n`)
        } else if (msg.type === 'data') {
          setStreamBytes((b) => b + (msg.bytes || 0))
          setStreamLog((s) => s + msg.hex + '\n')
        } else if (msg.type === 'error') {
          setStreamLog((s) => s + `[error] ${msg.message}\n`)
        } else if (msg.type === 'end') {
          setStreamLog((s) => s + `[end] ${new Date(msg.ts).toLocaleString()} 停止監聽\n`)
          es.close(); setStreaming(false)
        }
      } catch {}
    }
    es.onerror = () => { setStreamLog((s) => s + '[stream] 連線中斷\n'); es.close(); setStreaming(false) }
  }

  function stopStream() { try { esRef.current?.close() } catch {} setStreaming(false) }

  const portOptions = ports.map(p => ({ value: p.path, label: `${p.path}${p.manufacturer ? ` - ${p.manufacturer}` : ''}` }))

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button onClick={refreshPorts} disabled={loading}>重新整理序列阜</Button>
          {loading && <span>載入中…</span>}
          {error && <span style={{ color: 'crimson' }}>{error}</span>}
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="col" style={{ minWidth: 240 }}>
            <label>序列阜</label>
            <Select value={path} onChange={(v:any)=>setPath(String(v))} options={portOptions} placeholder="-- 選擇 --" />
          </div>
          <div className="col" style={{ maxWidth: 160 }}>
            <label>波特率</label>
            <Select value={String(baudRate)} onChange={(v:any)=>setBaudRate(Number(v))} options={baudOptions.map(b=>({ value: String(b), label: String(b) }))} />
          </div>
          <div className="col" style={{ maxWidth: 140 }}>
            <label>Data Bits</label>
            <Select value={String(dataBits)} onChange={(v:any)=>setDataBits(Number(v))} options={[5,6,7,8].map(b=>({ value: String(b), label: String(b) }))} />
          </div>
          <div className="col" style={{ maxWidth: 140 }}>
            <label>Stop Bits</label>
            <Select value={String(stopBits)} onChange={(v:any)=>setStopBits(Number(v))} options={[1,2].map(b=>({ value: String(b), label: String(b) }))} />
          </div>
          <div className="col" style={{ maxWidth: 180 }}>
            <label>Parity</label>
            <Select value={parity} onChange={(v:any)=>setParity(String(v) as any)} options={['none','even','odd'].map(p=>({ value: p, label: p }))} />
          </div>
          <div className="col" style={{ maxWidth: 180 }}>
            <label>擷取毫秒</label>
            <NumberInput value={durationMs} min={50} onChange={setDurationMs} />
          </div>
          <div className="col" style={{ maxWidth: 140 }}>
            <Button onClick={handleCapture}>開始擷取</Button>
          </div>
        </div>
        <div>
          <div>接收到位元組數：{captureBytes}</div>
          <TextBlock value={captureHex} mono minHeight={120} wrap="wrap" />
        </div>

        {/* 分隔線 */}
        <div style={{ borderTop: '1px solid var(--border-color, #333)', opacity: 0.6 }} />

        {/* 串流監聽區塊（合併至同一張卡片） */}
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button onClick={startStream} disabled={streaming}>開始監聽</Button>
          <Button onClick={stopStream} disabled={!streaming} className="btn--outline">停止監聽</Button>
          <div>累計位元組：{streamBytes}</div>
        </div>
        <TextBlock value={streamLog} mono minHeight={160} autoScroll wrap="wrap" />
        {/* 額外：顯示目前串流內容的 CRC 預覽（覆蓋尾碼前的計算） */}
        {crcPreview && <div className="text-muted">CRC 預覽：{crcPreview}</div>}
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <h3 className="m-0">TCP 發送測試</h3>
        <TcpSendTester />
      </div>
    </div>
  )
}

function TcpSendTester() {
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState(502)
  const [payloadHex, setPayloadHex] = useState('01 03 00 00 00 02 C4 0B')
  const [preparedHex, setPreparedHex] = useState('')
  const [prepareInfo, setPrepareInfo] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState('')

  function bytesToHex(arr: number[]) { return arr.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ') }

  function handleConvert() {
    setPrepareInfo(''); setPreparedHex('')
    try {
      const bytes = Array.from(hexToBytes(payloadHex))
      if (bytes.length === 0) throw new Error('Payload 至少需要 1 byte')
      const data = bytes.slice(0, -1)
      const oldTail = bytes[bytes.length - 1]
      const crc = computeCustomCRC8(data)
      bytes[bytes.length - 1] = crc
      setPreparedHex(bytesToHex(bytes))
      setPrepareInfo(`已轉換：覆蓋尾碼 ${oldTail.toString(16).toUpperCase().padStart(2, '0')} → ${crc.toString(16).toUpperCase().padStart(2, '0')}`)
    } catch (e: any) { setPrepareInfo(e?.message || '轉換時發生錯誤') }
  }

  async function handleSend() {
    setSending(true); setSendResult('')
    try {
      if (!preparedHex) throw new Error('請先按「轉換」產生預覽，再送出')
      const bytes = Array.from(hexToBytes(preparedHex))
      const resp = await fetch('/api/tcpprobe/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, port, payload: bytes, timeoutMs: 1000 }) })
      let json: any = null
      try { json = await resp.json() } catch { json = { success: false, message: `HTTP ${resp.status}` } }
      setSendResult(JSON.stringify(json, null, 2))
    } catch (e: any) { setSendResult(e?.message || '送出時發生錯誤') }
    finally { setSending(false) }
  }

  return (
    <>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="col" style={{ minWidth: 220 }}>
          <label>Host</label>
          <Input value={host} onChange={(e:any)=>setHost(e?.target?.value||'')} />
        </div>
        <div className="col" style={{ maxWidth: 160 }}>
          <label>Port</label>
          <NumberInput value={port} onChange={setPort} />
        </div>
        <div className="col" style={{ flex: 1, minWidth: 280 }}>
          <label>Payload (Hex)</label>
          <Input value={payloadHex} onChange={(e:any)=>setPayloadHex(e?.target?.value||'')} />
        </div>
        <div className="col" style={{ maxWidth: 120 }}>
          <Button onClick={handleConvert}>轉換</Button>
        </div>
        <div className="col" style={{ maxWidth: 120 }}>
          <Button onClick={handleSend} disabled={sending}>送出</Button>
        </div>
      </div>
      <div className="text-muted">預覽（將送出的封包）：</div>
  <TextBlock value={preparedHex} mono minHeight={80} wrap="wrap" ariaLabel="TCP 傳送預覽" />
      {!preparedHex && <div className="text-muted">請先按「轉換」</div>}
      {prepareInfo && <div className="text-muted">{prepareInfo}</div>}
      {sendResult && (
        <pre style={{ background: '#111', color: '#0f0', padding: 8, borderRadius: 4, overflow: 'auto' }}>{sendResult}</pre>
      )}
    </>
  )
}
