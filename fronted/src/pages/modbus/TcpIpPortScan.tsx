import React, { useMemo, useRef, useState } from 'react'
import { Button, Input, NumberInput, SmartTable, Badge } from '@/components/index'
import { runPortScan } from '@/api/network/portscan'

type Row = { port: number; ok: boolean; error?: string }

export default function TcpIpPortScan() {
  const [ip, setIp] = useState('192.168.1.100')
  const [start, setStart] = useState(1)
  const [end, setEnd] = useState(65535)
  const [timeoutMs, setTimeoutMs] = useState(300)
  const [concurrency, setConcurrency] = useState(200)
  const [open, setOpen] = useState<number[]>([])
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const esRef = useRef<EventSource | null>(null)

  const presets = useMemo(() => [502, 23, 80, 443, 8899, 4001, 4002, 10001, 3333], [])

  async function startScan() {
    setRunning(true)
    setOpen([])
    setLog('掃描中…')
    setRows([])
    try {
      const r = await runPortScan({ ip, start, end, timeoutMs, concurrency })
      if (r.success && r.data) {
        setOpen(r.data.open)
        setLog(`完成：找到 ${r.data.open.length} 個開放埠，耗時 ${r.data.elapsed}ms`)
      } else {
        setLog('掃描失敗：' + (r.message || ''))
      }
    } catch (e: any) {
      setLog('掃描異常：' + (e?.message || String(e)))
    } finally {
      setRunning(false)
    }
  }

  function startStream() {
    if (!ip) return
    setRunning(true)
    setOpen([])
    setRows([])
    setLog('即時掃描中…')
    const params = new URLSearchParams({
      ip,
      start: String(start),
      end: String(end),
      timeoutMs: String(timeoutMs),
      concurrency: String(concurrency)
    })
    const es = new EventSource(`/api/portscan/stream?${params.toString()}`)
    esRef.current = es
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

  function addPreset(p: number) {
    setStart(p); setEnd(p)
  }

  const columns = [
    { key: 'port', title: 'Port', width: 100 },
    { key: 'ok', title: 'Result', width: 120, render: (v: boolean) => v ? 'OPEN' : 'CLOSED' },
    { key: 'error', title: 'Error' },
  ]

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <h3 className="m-0">TCP 埠掃描</h3>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="col" style={{ minWidth: 240, maxWidth: 360 }}>
            <label>IP</label>
            <Input value={ip} onChange={e => setIp((e as any)?.target?.value)} />
          </div>
          <div className="col" style={{ maxWidth: 160 }}>
            <label>Start</label>
            <NumberInput value={start} onChange={setStart} min={1} />
          </div>
          <div className="col" style={{ maxWidth: 160 }}>
            <label>End</label>
            <NumberInput value={end} onChange={setEnd} min={1} />
          </div>
          <div className="col" style={{ maxWidth: 200 }}>
            <label>Timeout (ms)</label>
            <NumberInput value={timeoutMs} onChange={setTimeoutMs} min={10} />
          </div>
          <div className="col" style={{ maxWidth: 160 }}>
            <label>併發</label>
            <NumberInput value={concurrency} onChange={setConcurrency} min={1} />
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="text-muted">常見埠：</span>
          {presets.map(p => (
            <Button key={p} className="btn--sm btn--outline" onClick={() => addPreset(p)}>{p}</Button>
          ))}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button disabled={running} onClick={startScan}>{running ? '掃描中…' : '開始掃描(整批)'}</Button>
          <Button disabled={running} onClick={startStream} className="btn--outline">{running ? '掃描中…' : '開始掃描(即時逐筆)'}</Button>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div>{log}</div>
        {open.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>開放埠</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {open.map(p => <Badge key={p} color="blue">{p}</Badge>)}
            </div>
          </div>
        )}
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>逐筆結果</div>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            <SmartTable columns={columns as any} data={rows as any} rowKey={(r:any)=>String(r.port)} />
          </div>
        </div>
      </div>
    </div>
  )
}
