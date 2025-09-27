import { useState } from 'react'
import { runPortScan } from '../../../api/network/portscan'
import { Table, Button, Form, FormItem, Input, InputNumber } from '../../../components'

export default function PortScannerPage() {
  const [ip, setIp] = useState('192.168.1.100')
  const [range, setRange] = useState({ start: 1, end: 65535 })
  const [timeoutMs, setTimeoutMs] = useState(300)
  const [concurrency, setConcurrency] = useState(200)
  const [open, setOpen] = useState<number[]>([])
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [rows, setRows] = useState<{port:number; ok:boolean; error?:string}[]>([])

  const presets = [502, 23, 80, 443, 8899, 4001, 4002, 10001, 3333]

  const startScan = async () => {
    setRunning(true)
    setOpen([])
    setLog('掃描中…')
    setRows([])
    try {
      const r = await runPortScan({ ip, start: range.start, end: range.end, timeoutMs, concurrency })
      if (r.success && r.data) {
        setOpen(r.data.open)
        setLog(`完成：找到 ${r.data.open.length} 個開放埠，耗時 ${r.data.elapsed}ms`)
      } else {
        setLog('掃描失敗：' + (r.message || ''))
      }
    } catch (e:any) { setLog('掃描異常：' + (e.message || String(e))) }
    finally { setRunning(false) }
  }

  const startStream = async () => {
    if (!ip) return
    setRunning(true)
    setOpen([])
    setRows([])
    setLog('即時掃描中…')
    const params = new URLSearchParams({
      ip,
      start: String(range.start),
      end: String(range.end),
      timeoutMs: String(timeoutMs),
      concurrency: String(concurrency)
    })
    const es = new EventSource(`/api/portscan/stream?${params.toString()}`)
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'progress') {
          setRows((arr) => [...arr, { port: msg.port, ok: !!msg.ok, error: msg.error }])
          if (msg.ok) setOpen(o => [...o, msg.port])
          setLog(`掃描 ${msg.scanned}/${msg.total}，目前開放：${msg.openCount}`)
        } else if (msg.type === 'done') {
          setLog(`完成：共掃描 ${msg.scanned} 個，開放 ${msg.openCount}`)
          es.close()
          setRunning(false)
        } else if (msg.type === 'error') {
          setLog('掃描錯誤：' + (msg.message || ''))
          es.close()
          setRunning(false)
        }
      } catch {}
    }
    es.onerror = () => {
      setLog('串流連線中斷')
      es.close()
      setRunning(false)
    }
  }

  const addPreset = (p:number) => {
    setRange(r => ({ ...r, start: p, end: p }))
  }

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ marginTop: 0 }}>TCP 埠掃描</h3>
  <Form>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(160px, 1fr))', gap: 12 }}>
          <FormItem label="IP">
            <Input value={ip} onChange={e=>setIp((e?.target?.value) as any)} />
          </FormItem>
          <FormItem label="Start">
            <InputNumber value={range.start} onChange={(v:any)=>setRange({ ...range, start: Number(v) })} min={1} />
          </FormItem>
          <FormItem label="End">
            <InputNumber value={range.end} onChange={(v:any)=>setRange({ ...range, end: Number(v) })} min={1} />
          </FormItem>
          <FormItem label="Timeout(ms)">
            <InputNumber value={timeoutMs} onChange={(v:any)=>setTimeoutMs(Number(v))} min={10} step={10} />
          </FormItem>
          <FormItem label="併發">
            <InputNumber value={concurrency} onChange={(v:any)=>setConcurrency(Number(v))} min={1} />
          </FormItem>
        </div>
      </Form>
      <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#666' }}>常見埠：</span>
        {presets.map(p => (
          <Button key={p} size="sm" variant="outline" onClick={() => addPreset(p)}>{p}</Button>
        ))}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button disabled={running} onClick={startScan}>{running ? '掃描中…' : '開始掃描(整批)'}</Button>
        <Button disabled={running} onClick={startStream} variant="outline">{running ? '掃描中…' : '開始掃描(即時逐筆)'}</Button>
      </div>
      <div className="card" style={{ marginTop: 4 }}>
        <div style={{ marginBottom: 8 }}>{log}</div>
        {open.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>開放埠</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {open.map(p => <span key={p} className="badge badge--info">{p}</span>)}
            </div>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>逐筆結果</div>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            {/* 改用共用 Table 包裝（ESM 匯入） */}
            {(() => {
              const columns = [
                { title: 'Port', dataIndex: 'port', key: 'port', width: 100 },
                { title: 'Result', dataIndex: 'ok', key: 'ok', width: 120, render: (v: boolean) => v ? 'OPEN' : 'CLOSED' },
                { title: 'Error', dataIndex: 'error', key: 'error' },
              ];
              return <Table columns={columns as any} dataSource={rows as any} rowKey={(r: any) => String(r.port)} />
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}
