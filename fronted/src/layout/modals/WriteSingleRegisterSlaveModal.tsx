import React, { useMemo, useState } from 'react'
import { Modal, Select, Button, NumberInput, SmartTable } from '@/components'
import { writeSingleRegister } from '@/api/modbus/operations'
import { useMessages } from '@/components/contexts/MessagesContext'

type Host = { id: string; name?: string; ip?: string; port?: number; unitId?: number; connected: boolean }

type History = { id: string; ts: number; hostId?: string; unitId?: number; ip?: string; port?: number; addr: number; value: number; ok: boolean; message?: string }

export default function WriteSingleRegisterSlaveModal({ open, onClose, hosts, push }: { open: boolean; onClose: () => void; hosts: Host[]; push: (lvl: 'info'|'success'|'warning'|'error', text: string) => void }) {
  const [selected, setSelected] = useState('')
  const [unitId, setUnitId] = useState<number>(1)
  const [slaveType, setSlaveType] = useState<'SL-SW8CH'|'SL-1-10V4CHDIM'>('SL-SW8CH')
  const [groupMode, setGroupMode] = useState<'群組'|'場景'>('群組')
  const [addr, setAddr] = useState(0)
  const [value, setValue] = useState(0)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<History[]>([])
  const { push: pushMsg } = useMessages()

  const selectedHost = useMemo(() => hosts.find(h => h.id === selected), [hosts, selected])
  const hostNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const h of hosts) map[h.id] = h.name || h.id
    return map
  }, [hosts])

  const validate = () => {
    if (!selected) { push('warning', '請先選擇主機'); return false }
    if (!selectedHost?.connected) { push('warning', '目標主機未連線'); return false }
    if (!Number.isFinite(unitId) || unitId < 1 || unitId > 247) { push('warning', '站號需為 1~247 的整數'); return false }
    if (!Number.isFinite(addr) || addr < 0 || addr > 65535) { push('warning', '位址需為 0~65535 的整數'); return false }
    if (!Number.isFinite(value) || value < 0 || value > 0xFFFF) { push('warning', '數值需為 0~65535 的整數'); return false }
    return true
  }

  async function doWrite() {
    if (!validate()) return
    try {
      setLoading(true)
      const r = await writeSingleRegister({ hostId: selected, unitId: Number(unitId) }, Number(addr), Number(value))
      const ok = (r as any)?.success !== false
  setHistory(h => [{ id: crypto.randomUUID?.() ?? String(Date.now()), ts: Date.now(), hostId: selected, unitId: Number(unitId), addr: Number(addr), value: Number(value), ok, message: (r as any)?.message }, ...h])
      try { pushMsg({ channel: 'modbusSend', level: ok ? 'success' : 'warning', text: `WRITE 0x06：${selected} @${addr} = ${value} (站號:${unitId})`, hostId: selected, slaveAddr: Number(unitId), action: 'write', ok, target: 'slave', modbus: { fc: 0x06, address: Number(addr), values: [Number(value)] } }) } catch {}
    } catch (e: any) {
      // 改以結構化訊息呈現錯誤
      try { pushMsg({ channel: 'modbusSend', level: 'error', text: `WRITE 失敗：${selected} @${addr} = ${value} (站號:${unitId})`, hostId: selected, slaveAddr: Number(unitId), action: 'write', ok: false, target: 'slave', modbus: { fc: 0x06, address: Number(addr), values: [Number(value)] } }) } catch {}
    } finally { setLoading(false) }
  }

  const columns = [
    { key: 'ts', title: '時間', width: 160, render: (v: number) => new Date(v).toLocaleString() },
    { key: 'hostId', title: '主機名稱', width: 180, render: (v: string) => hostNameMap[v] || v || '—' },
    { key: 'unitId', title: '站號', width: 70 },
    { key: 'addr', title: '位址', width: 80 },
    { key: 'value', title: '數值', width: 80 },
  // 485 幀設定移除
    { key: 'ok', title: '狀態', width: 90, render: (ok: boolean) => ok ? '成功' : '失敗' },
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
    <Modal isOpen={open} onClose={onClose} title="寫入從機單一保持暫存器" maxWidth={'92vw'}>
      <div className="col" style={{ gap: 12 }}>
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

        <div className="row" style={{ gap: 8, alignItems: 'center', position: 'relative', zIndex: 1 }} />

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
