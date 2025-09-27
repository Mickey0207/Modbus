import React, { useMemo, useState } from 'react'
import { Modal, Select, Button, NumberInput, SmartTable } from '@/components'
import { IconCopy, IconEdit } from '@/components/icons'
import { writeSingleRegister } from '@/api/modbus/operations'

type Host = { id: string; ip?: string; port?: number; unitId?: number; connected: boolean }

type History = { id: string; ts: number; hostId: string; unitId?: number; ip?: string; port?: number; addr: number; value: number; ok: boolean; message?: string }

export default function WriteSingleRegisterModal({ open, onClose, hosts, push }: { open: boolean; onClose: () => void; hosts: Host[]; push: (lvl: 'info'|'success'|'warning'|'error', text: string) => void }) {
  const [selected, setSelected] = useState('')
  const [addr, setAddr] = useState(0)
  const [value, setValue] = useState(0)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<History[]>([])

  const selectedHost = useMemo(() => hosts.find(h => h.id === selected), [hosts, selected])

  const validate = () => {
    if (!selected) { push('warning', '請先選擇主機'); return false }
    if (!selectedHost?.connected) { push('warning', '目標主機未連線'); return false }
    if (!Number.isFinite(addr) || addr < 0 || addr > 65535) { push('warning', '位址需為 0~65535 的整數'); return false }
    if (!Number.isFinite(value) || value < 0 || value > 0xFFFF) { push('warning', '數值需為 0~65535 的整數'); return false }
    return true
  }

  async function doWrite() {
    if (!validate()) return
    try {
      setLoading(true)
      const r = await writeSingleRegister(selected, Number(addr), Number(value))
      const ok = (r as any)?.success !== false
      setHistory(h => [{ id: crypto.randomUUID?.() ?? String(Date.now()), ts: Date.now(), hostId: selected, unitId: selectedHost?.unitId, ip: selectedHost?.ip, port: selectedHost?.port, addr: Number(addr), value: Number(value), ok, message: (r as any)?.message }, ...h])
      push(ok ? 'success' : 'warning', ok ? `寫入成功：${selected} @${addr} = ${value}` : `寫入可能失敗：${(r as any)?.message ?? '未知'}`)
    } catch (e: any) {
      push('error', e?.message ? `寫入失敗：${e.message}` : '寫入失敗')
    } finally { setLoading(false) }
  }

  const columns = [
    { key: 'ts', title: '時間', width: 160, render: (v: number) => new Date(v).toLocaleString() },
    { key: 'hostId', title: 'ID', width: 110 },
    { key: 'ip', title: 'IP', width: 140 },
    { key: 'port', title: 'Port', width: 80 },
    { key: 'unitId', title: '站號', width: 80 },
    { key: 'addr', title: '位址', width: 80 },
    { key: 'value', title: '數值', width: 80 },
    { key: 'ok', title: '狀態', width: 100, render: (ok: boolean) => ok ? '寫入成功' : '寫入失敗' },
    { key: 'message', title: '訊息' },
  ]

  const copyRow = async (row: History) => {
    const text = `@${row.addr} = ${row.value}`
    try { await navigator.clipboard.writeText(text); push('success', '已複製該列參數') }
    catch { push('warning', '無法存取剪貼簿') }
  }

  const applyRow = (row: History) => {
    if (!row) return
    if (row.hostId) setSelected(String(row.hostId))
    if (Number.isFinite(row.addr)) setAddr(Number(row.addr))
    if (Number.isFinite(row.value)) setValue(Number(row.value))
    push('info', '已將該列參數填入上方')
  }

  

  return (
    <Modal isOpen={open} onClose={onClose} title="寫入單一保持暫存器" maxWidth={'92vw'}>
      <div className="col" style={{ gap: 12 }}>
        {/* 上方：參數區（全寬） */}
        <div className="card" style={{ overflow: 'visible', position: 'relative', zIndex: 2 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="text-muted">選擇主機、位址與數值後執行寫入（Function 0x06）。</div>
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
                  { value: 'DEMO', label: 'DEMO 192.168.0.123:502 已連線' },
                  ...hosts.map(h => ({ value: h.id, label: `${h.id} ${h.ip ?? ''}:${h.port ?? ''} ${h.connected ? '已連線' : '未連線'}` }))
                ]}
              />
            </div>
            <div className="col" style={{ maxWidth: 200 }}>
              <label>位址</label>
              <NumberInput value={addr} onChange={setAddr} min={0} max={65535} />
            </div>
            <div className="col" style={{ maxWidth: 200 }}>
              <label>數值</label>
              <NumberInput value={value} onChange={setValue} min={0} max={65535} />
            </div>
            <div className="col" style={{ maxWidth: 140 }}>
              <Button onClick={doWrite} disabled={loading || !selected || !selectedHost?.connected}>寫入</Button>
            </div>
          </div>
        </div>

        {/* 中間：工具列（保留空位以後續擴充） */}
        <div className="row" style={{ gap: 8, alignItems: 'center', position: 'relative', zIndex: 1 }} />

        {/* 下方：表格（全寬） */}
        <div className="card" style={{ overflow: 'auto', maxHeight: '72vh' }}>
          <SmartTable
            columns={columns as any}
            data={history as any}
            rowKey={(r:any)=>r.id}
            renderActions={(r:any)=> (
              <div className="row" style={{ gap: 6 }}>
                <button className="icon-btn" title="複製" aria-label="複製" onClick={() => copyRow(r)}><IconCopy /></button>
                <button className="icon-btn" title="填入" aria-label="填入" onClick={() => applyRow(r)}><IconEdit /></button>
              </div>
            )}
          />
        </div>
      </div>
    </Modal>
  )
}
