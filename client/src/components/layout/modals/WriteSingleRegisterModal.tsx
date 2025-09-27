import React, { useEffect, useMemo, useState } from 'react'
import { Select as SelectComponent, Modal as ModalFromComponents } from '../..'
import { writeSingleRegister } from '../../../api/modbus/operations'

const GlassModal: any = ModalFromComponents as any

type Host = { id: string; ip?: string; port?: number; unitId?: number; connected: boolean }

export default function WriteSingleRegisterModal({ open, onClose, hosts, push }: { open: boolean; onClose: () => void; hosts: Host[]; push: (lvl: any, text: string) => void }) {
  const [selected, setSelected] = useState('')
  const [addr, setAddr] = useState(0)
  const [writeVal, setWriteVal] = useState(0)
  const [loading, setLoading] = useState(false)
  const selectedHost = useMemo(() => hosts.find(h => h.id === selected), [hosts, selected])

  useEffect(() => { /* reset state if needed */ }, [open])

  async function doWrite() {
    if (!selected) { push('warning', '請先選擇主機'); return }
    try {
      setLoading(true)
      const res = await writeSingleRegister(selected, Number(addr), Number(writeVal))
      if (!res.success) throw new Error('寫入失敗')
      push('success', `寫入成功：${selected} @${addr} = ${writeVal}`)
    } catch (e: any) {
      push('error', e.message || String(e))
    } finally { setLoading(false) }
  }

  return (
    <GlassModal isOpen={open} onClose={onClose}>
      <div className="stack">
        <h3 className="m-0 text-gray-900">寫入單一保持暫存器（指定主機）</h3>
        <div className="text-muted">請選擇主機並輸入位址與數值後執行寫入。</div>
        <div className="form">
          <div className="form-group">
            <label>目標主機</label>
            <SelectComponent
              value={selected}
              onChange={setSelected as any}
              placeholder="— 請選擇 —"
              options={hosts.map(h => ({ value: h.id, label: `${h.id} ${h.ip ?? ''}:${h.port ?? ''} ${h.connected ? '已連線' : '未連線'}` })) as any}
            />
          </div>
          {selected && (<div className="text-muted">目前狀態：{selectedHost?.connected ? '已連線' : '未連線'}</div>)}
          <h4 className="m-0 mt-2 text-gray-900">寫入參數</h4>
          <div className="form__grid">
            <div className="form-group">
              <label>寫入位址</label>
              <input type="number" value={addr} onChange={e => setAddr(Number(e.target.value))} />
            </div>
            <div className="form-group">
              <label>寫入數值</label>
              <input type="number" value={writeVal} onChange={e => setWriteVal(Number(e.target.value))} />
            </div>
          </div>
          <div className="form__actions">
            <button className="btn" onClick={doWrite} disabled={loading || !selected || !selectedHost?.connected}>寫入</button>
          </div>
        </div>
      </div>
    </GlassModal>
  )
}
