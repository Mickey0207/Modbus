import React, { useEffect, useMemo, useRef, useState } from 'react'
import { listSerialPorts, captureSerial } from '../../../api/serial/spy'
import { Button, Select as UiSelect, Form, FormItem, Input, InputNumber, TextArea } from '../../../components'
const SelectAny: any = UiSelect

type PortInfo = {
  path: string
  manufacturer?: string
  serialNumber?: string
  pnpId?: string
  locationId?: string
  productId?: string
  vendorId?: string
}

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
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16)
  }
  return out
}

export default function SerialSpyPage() {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [path, setPath] = useState('')
  const [baudRate, setBaudRate] = useState(9600)
  const [dataBits, setDataBits] = useState(8)
  const [stopBits, setStopBits] = useState(1)
  const [parity, setParity] = useState<'none' | 'even' | 'odd'>('none')
  const [durationMs, setDurationMs] = useState(1000)
  const [captureHex, setCaptureHex] = useState('')
  const [captureBytes, setCaptureBytes] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [streamLog, setStreamLog] = useState<string>('')
  const [streamBytes, setStreamBytes] = useState(0)
  const [es, setEs] = useState<EventSource | null>(null)
  const streamBoxRef = useRef<HTMLTextAreaElement | null>(null)

  // 當 streamLog 更新時，自動捲動至底部
  useEffect(() => {
    const el = streamBoxRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [streamLog])

  // For TCP send test
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState<number>(502)
  const [payloadHex, setPayloadHex] = useState('01 03 00 00 00 02 C4 0B')
  const [sendResult, setSendResult] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [preparedHex, setPreparedHex] = useState<string>('')
  const [prepareInfo, setPrepareInfo] = useState<string>('')

  // 單一正確 CRC 規則（已驗證）：CRC-8 poly=0x31, init=0x00, no-reflect, xorout=0x9F

  useEffect(() => {
    refreshPorts()
  }, [])

  async function refreshPorts() {
    setLoading(true)
    setError(null)
    try {
      const res = await listSerialPorts()
      if (res.success) {
        setPorts(res.data as any)
        if (!path && (res.data as any).length) setPath((res.data as any)[0].path)
      } else {
        setError('列出序列阜失敗')
      }
    } catch (e: any) {
      setError(e?.message || '列出序列阜時發生錯誤')
    } finally {
      setLoading(false)
    }
  }

  async function handleCapture() {
    if (!path) return setError('請先選擇序列阜')
    setError(null)
    setCaptureHex('')
    setCaptureBytes(0)
    try {
      const res = await captureSerial({ path, baudRate, dataBits, stopBits, parity, durationMs })
      if (!res.success) throw new Error('擷取失敗')
      const data = (res as any).data
      setCaptureHex(data.hex)
      setCaptureBytes(data.bytes)
    } catch (e: any) {
      setError(e?.message || '擷取時發生錯誤')
    }
  }

  function bytesToHex(arr: number[]) {
    return arr.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
  }

  function handleConvert() {
    setPrepareInfo('')
    setPreparedHex('')
    setError(null)
    try {
      const bytes = Array.from(hexToBytes(payloadHex))
      if (bytes.length === 0) throw new Error('Payload 至少需要 1 byte')
      const data = bytes.slice(0, -1)
      const oldTail = bytes[bytes.length - 1]
      const crc = computeCustomCRC8(data)
      bytes[bytes.length - 1] = crc
      setPreparedHex(bytesToHex(bytes))
      setPrepareInfo(`已轉換：覆蓋尾碼 ${oldTail.toString(16).toUpperCase().padStart(2, '0')} → ${crc.toString(16).toUpperCase().padStart(2, '0')}`)
    } catch (e: any) {
      setError(e?.message || '轉換時發生錯誤')
    }
  }

  async function handleSend() {
    setSending(true)
    setSendResult('')
    setError(null)
    try {
      if (!preparedHex) {
        throw new Error('請先按「轉換」產生預覽，再送出')
      }
      const bytes = Array.from(hexToBytes(preparedHex))
      const resp = await fetch('/api/tcpprobe/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, payload: bytes, timeoutMs: 1000 })
      })
      let json: any = null
      try { json = await resp.json() } catch { json = { success: false, message: `HTTP ${resp.status}` } }
      if (!resp.ok && json) {
        setSendResult(JSON.stringify(json, null, 2))
      } else {
        setSendResult(JSON.stringify(json, null, 2))
      }
    } catch (e: any) {
      setError(e?.message || '送出時發生錯誤')
    } finally {
      setSending(false)
    }
  }

  // ===== CRC Utilities =====
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
  function computeCustomCRC8(data: number[]) {
    return crc8Generic(data, 0x31, 0x00, false, false, 0x9F)
  }
  const crcPreview = useMemo(() => {
    try {
      const bytes = Array.from(hexToBytes(payloadHex))
      if (bytes.length === 0) return ''
      const v = computeCustomCRC8(bytes.slice(0, -1))
      return v.toString(16).toUpperCase().padStart(2, '0')
    } catch {
      return ''
    }
  }, [payloadHex])

  const baudOptions = [9600, 19200, 38400, 57600, 115200]

  function startStream() {
    if (!path) return setError('請先選擇序列阜')
    setError(null)
    setStreaming(true)
    setStreamLog('')
    setStreamBytes(0)
    const params = new URLSearchParams({
      path,
      baudRate: String(baudRate),
      dataBits: String(dataBits),
      stopBits: String(stopBits),
      parity
    })
    const _es = new EventSource(`/api/serialspy/stream?${params.toString()}`)
    _es.onmessage = (ev) => {
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
          _es.close()
          setStreaming(false)
        }
      } catch {}
    }
    _es.onerror = () => {
      setStreamLog((s) => s + '[stream] 連線中斷\n')
      _es.close()
      setStreaming(false)
    }
    setEs(_es)
  }

  function stopStream() {
    try { es?.close() } catch {}
    setStreaming(false)
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 16 }}>
      <h2 style={{ margin: 0 }}>RS-485 監聽 (Serial Spy)</h2>
      <div className="card" style={{ display: 'grid', gap: 12, padding: 16 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button onClick={refreshPorts} disabled={loading} size="md">重新整理序列阜</Button>
          {loading && <span>載入中…</span>}
          {error && <span style={{ color: 'crimson' }}>{error}</span>}
        </div>
  <Form>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(140px, 1fr))', gap: 12, alignItems: 'end' }}>
            <FormItem label="序列阜">
              <SelectAny
                value={path}
                onChange={(v: any) => setPath(String(v))}
                placeholder="-- 選擇 --"
                options={ports.map((p) => ({ value: p.path, label: `${p.path}${p.manufacturer ? ` - ${p.manufacturer}` : ''}` }))}
              />
            </FormItem>
            <FormItem label="波特率">
              <SelectAny
                value={String(baudRate)}
                onChange={(v: any) => setBaudRate(Number(v))}
                options={baudOptions.map((b) => ({ value: String(b), label: String(b) }))}
              />
            </FormItem>
            <FormItem label="Data Bits">
              <SelectAny
                value={String(dataBits)}
                onChange={(v: any) => setDataBits(Number(v))}
                options={[5,6,7,8].map((b) => ({ value: String(b), label: String(b) }))}
              />
            </FormItem>
            <FormItem label="Stop Bits">
              <SelectAny
                value={String(stopBits)}
                onChange={(v: any) => setStopBits(Number(v))}
                options={[1,2].map((b) => ({ value: String(b), label: String(b) }))}
              />
            </FormItem>
            <FormItem label="Parity">
              <SelectAny
                value={parity}
                onChange={(v: any) => setParity(String(v) as any)}
                options={['none','even','odd'].map((p) => ({ value: p, label: p }))}
              />
            </FormItem>
            <FormItem label="擷取毫秒">
              <InputNumber value={durationMs} min={50} step={50} onChange={(v:any) => setDurationMs(Number(v))} />
            </FormItem>
            <div>
              <Button onClick={handleCapture} size="md">開始擷取</Button>
            </div>
          </div>
        </Form>
        <div>
          <div>接收到位元組數：{captureBytes}</div>
          <TextArea value={captureHex} readOnly style={{ width: '100%', minHeight: 120, fontFamily: 'monospace' }} />
        </div>
      </div>

      <hr />

      <div className="card" style={{ display: 'grid', gap: 12, padding: 16 }}>
        <h3 style={{ margin: 0 }}>持續監聽（SSE）</h3>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button onClick={startStream} disabled={streaming} size="md">開始監聽</Button>
          <Button onClick={stopStream} disabled={!streaming} size="md" variant="neutral">停止監聽</Button>
          <div>累計位元組：{streamBytes}</div>
        </div>
        <TextArea ref={streamBoxRef as any} value={streamLog} readOnly style={{ width: '100%', minHeight: 160, fontFamily: 'monospace' }} />
      </div>

      <div className="card" style={{ display: 'grid', gap: 12, padding: 16 }}>
        <h3 style={{ margin: 0 }}>TCP 發送測試 (配合透明轉發)</h3>
  <Form>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 1.6fr auto auto', gap: 12, alignItems: 'end' }}>
            <FormItem label="Host">
              <Input value={host} onChange={(e)=>setHost((e?.target?.value)||'')} />
            </FormItem>
            <FormItem label="Port">
              <InputNumber value={port} onChange={(v:any)=>setPort(Number(v))} />
            </FormItem>
            <FormItem label="Payload (Hex)">
              <Input value={payloadHex} onChange={(e)=>setPayloadHex((e?.target?.value)||'')} />
            </FormItem>
            <div>
              <Button onClick={handleConvert} size="md">轉換</Button>
            </div>
            <div>
              <Button onClick={handleSend} disabled={sending} size="md">送出</Button>
            </div>
          </div>
        </Form>
        <div style={{ color: '#9cdcfe' }}>
          預覽（將送出的封包）：
        </div>
        <TextArea value={preparedHex} readOnly placeholder='請先按「轉換」' style={{ width: '100%', minHeight: 80, fontFamily: 'monospace' }} />
        {prepareInfo && <div style={{ color: '#9cdcfe' }}>{prepareInfo}</div>}
        {sendResult && (
          <pre style={{ background: '#111', color: '#0f0', padding: 8, borderRadius: 4, overflow: 'auto' }}>{sendResult}</pre>
        )}
      </div>
    </div>
  )
}
