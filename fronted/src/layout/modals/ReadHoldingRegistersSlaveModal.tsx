import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Select, SmartTable, Button, NumberInput } from '@/components'
import { readHoldingRegisters } from '@/api/modbus/operations'
import { useMessages } from '@/contexts/MessagesContext'

type Host = { id: string; name?: string; ip?: string; port?: number; unitId?: number; connected: boolean }

export default function ReadHoldingRegistersSlaveModal({ open, onClose, hosts, push }: { open: boolean; onClose: () => void; hosts: Host[]; push: (lvl: 'info'|'success'|'warning'|'error', text: string) => void }) {
  const [selected, setSelected] = useState('')
  const [unitId, setUnitId] = useState<number>(1)
  const [slaveType, setSlaveType] = useState<'SL-SW8CH'|'SL-1-10V4CHDIM'>('SL-SW8CH')
  const [groupMode, setGroupMode] = useState<'群組'|'場景'>('群組')
  const [addr, setAddr] = useState(0)
  const [len, setLen] = useState(1)
  const [loading, setLoading] = useState(false)
  const [fmt, setFmt] = useState<'hex' | 'dec' | 'oct' | 'bin'>('dec')
  const [history, setHistory] = useState<Array<{ id: string; ts: number; unitId?: number; values: number[]; hostId: string; addr: number; len: number; ok: boolean }>>([])
  const selectedHost = useMemo(() => hosts.find(h => h.id === selected), [hosts, selected])
  const { push: pushMsg } = useMessages()
  const hostNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const h of hosts) map[h.id] = h.name || h.id
    return map
  }, [hosts])

  useEffect(() => { if (open) setHistory([]) }, [open])

  const formatValue = (v: number) => (
    fmt === 'hex' ? '0x' + v.toString(16).toUpperCase() :
    fmt === 'oct' ? '0o' + v.toString(8) :
    fmt === 'bin' ? '0b' + v.toString(2) : String(v)
  )

  async function doRead() {
    if (!selected) { push('warning', '請先選擇主機'); return }
    if (!selectedHost?.connected) { push('warning', '目標主機未連線'); return }
    if (!Number.isFinite(unitId) || unitId < 1 || unitId > 247) { push('warning', '站號需為 1~247 的整數'); return }
    if (!Number.isFinite(addr) || addr < 0 || addr > 65535) { push('warning', '起始位址需為 0~65535 的整數'); return }
    if (!Number.isFinite(len) || len <= 0 || len > 125) { push('warning', '讀取長度需為 1~125 的整數'); return }
    if (addr + len - 1 > 65535) { push('warning', '位址加上長度超出範圍 (最後位址需 ≤ 65535)'); return }
    try {
      setLoading(true)
      const r = await readHoldingRegisters({ hostId: selected, unitId: Number(unitId) }, Number(addr), Number(len))
      if (!r.success || !Array.isArray(r.data)) throw new Error('讀取失敗')
      const values = r.data
  setHistory(h => [{ id: (globalThis.crypto as any)?.randomUUID?.() || String(Date.now()), ts: Date.now(), unitId: Number(unitId), values, hostId: selected, addr: Number(addr), len: Number(len), ok: true }, ...h])
      try { pushMsg({ channel: 'modbusSend', level: 'success', text: `READ 0x03：${selected} @${addr} x${len} (站號:${unitId})`, hostId: selected, slaveAddr: Number(unitId), action: 'read', ok: true, target: 'slave', modbus: { fc: 0x03, address: Number(addr), quantity: Number(len), values } }) } catch {}
    } catch (e: any) {
      // 改以結構化訊息呈現錯誤
      try { pushMsg({ channel: 'modbusSend', level: 'error', text: `READ 失敗：${selected} @${addr} x${len} (站號:${unitId})`, hostId: selected, slaveAddr: Number(unitId), action: 'read', ok: false, target: 'slave', modbus: { fc: 0x03, address: Number(addr), quantity: Number(len) } }) } catch {}
  setHistory(h => [{ id: (globalThis.crypto as any)?.randomUUID?.() || String(Date.now()), ts: Date.now(), unitId: Number(unitId), values: [], hostId: selected, addr: Number(addr), len: Number(len), ok: false }, ...h])
    } finally { setLoading(false) }
  }

  const latest = history[0]
  const copyLatest = async () => {
    if (!latest) return
    const text = latest.values.map(formatValue).join(', ')
    try { await navigator.clipboard.writeText(text); push('success', '已複製到剪貼簿') }
    catch { push('warning', '無法存取剪貼簿') }
  }

  const copyRow = async (row: any) => {
    const text = (row.values || []).map((v: number) => formatValue(v)).join(', ')
    try { await navigator.clipboard.writeText(text); push('success', '已複製該列內容') }
    catch { push('warning', '無法存取剪貼簿') }
  }

  const applyRow = (row: any) => {
    if (!row) return
    if (row.hostId) setSelected(String(row.hostId))
    if (Number.isFinite(row.addr)) setAddr(Number(row.addr))
    if (Number.isFinite(row.len)) setLen(Number(row.len))
    push('info', '已將該列參數填入上方')
  }

  const columns = [
    { key: 'ts', title: '時間', width: 170, render: (v: number) => new Date(v).toLocaleString() },
    { key: 'hostId', title: '主機名稱', width: 180, render: (v: string) => hostNameMap[v] || v || '—' },
    { key: 'unitId', title: '站號', width: 70 },
    { key: 'addr', title: '起始位址', width: 100 },
    { key: 'len', title: '讀取長度', width: 100 },
  // 485 幀相關設定移除，使用主機透明轉發設定
    { key: 'ok', title: '狀態', width: 90, render: (v: boolean) => (v ? '成功' : '失敗') },
    { key: 'values', title: '內容', render: (_: any, r: any) => (
      <span className="mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block', overflow: 'hidden' }}>
        {Array.isArray(r.values) ? r.values.map((v: number) => formatValue(v)).join(', ') : ''}
      </span>
    ) },
  ]

  return (
    <Modal isOpen={open} onClose={onClose} title="讀取從機保持暫存器" maxWidth={'92vw'}>
      <div className="col" style={{ gap: 12 }}>
        <div className="card" style={{ overflow: 'visible', position: 'relative', zIndex: 2 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="text-muted">請選擇目標主機、起始位址與讀取長度後執行讀取（Function 0x03）。</div>
            <div className="text-muted" style={{ marginLeft: 12 }}>
              {selected ? <>目前狀態：{selectedHost?.connected ? '已連線' : '未連線'}，站號：{selectedHost?.unitId ?? '—'}</> : null}
            </div>
          </div>
          <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginTop: 8 }}>
            <div className="col" style={{ minWidth: 400, maxWidth: 640, marginBottom: 12 }}>
              <label>目標主機</label>
              <Select
                value={selected}
                onChange={(v: string)=>setSelected(String(v))}
                className="wide"
                options={[
                  ...hosts.map(h => ({ value: h.id, label: `${h.id} ${h.ip ?? ''}:${h.port ?? ''} ${h.connected ? '已連線' : '未連線'}` }))
                ]}
              />
            </div>
            <div className="col" style={{ maxWidth: 140 }}>
              <label>站號</label>
              <NumberInput value={unitId} onChange={setUnitId} min={1} max={247} />
            </div>
            <div className="col" style={{ maxWidth: 220 }}>
              <label>從機類型</label>
              <Select value={slaveType} onChange={(v: string)=>setSlaveType(v as any)} options={[
                { value: 'SL-SW8CH', label: 'SL-SW8CH' },
                { value: 'SL-1-10V4CHDIM', label: 'SL-1-10V4CHDIM' },
              ]} />
            </div>
            <div className="col" style={{ maxWidth: 180 }}>
              <label>群組/場景</label>
              <Select value={groupMode} onChange={(v: string)=>setGroupMode(v as any)} options={[
                { value: '群組', label: '群組' },
                { value: '場景', label: '場景' },
              ]} />
            </div>
            <div className="col" style={{ maxWidth: 200 }}>
              <label>起始位址</label>
              <NumberInput value={addr} onChange={setAddr} min={0} max={65535} />
            </div>
            <div className="col" style={{ maxWidth: 200 }}>
              <label>讀取長度</label>
              <NumberInput value={len} onChange={setLen} min={1} max={125} />
            </div>
            <div className="col" style={{ maxWidth: 140 }}>
              <Button onClick={doRead} disabled={loading || !selected || !selectedHost?.connected}>讀取</Button>
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 8, alignItems: 'center', position: 'relative', zIndex: 1 }}>
          <label style={{ opacity: .8 }}>格式</label>
          <Select
            value={fmt}
            onChange={(v: string)=>setFmt(v as any)}
            options={[
              { value: 'hex', label: '十六進位' },
              { value: 'dec', label: '十進位' },
              { value: 'oct', label: '八進位' },
              { value: 'bin', label: '二進位' },
            ]}
          />
          <Button className="btn--outline" onClick={copyLatest} disabled={!latest}>複製最新</Button>
        </div>

        <div className="card" style={{ overflow: 'auto', maxHeight: '72vh' }}>
          <SmartTable
            columns={columns as any}
            data={history as any}
            rowKey={(r:any)=>r.id}
            showActions={false}
          />
        </div>
      </div>
    </Modal>
  )
}
