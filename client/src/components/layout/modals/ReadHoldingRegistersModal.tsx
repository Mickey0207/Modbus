import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Select as SelectComponent, Modal as ModalFromComponents, Table } from '../..'
import { readHoldingRegisters } from '../../../api/modbus/operations'

const GlassModal: any = ModalFromComponents as any

type Host = { id: string; ip?: string; port?: number; unitId?: number; connected: boolean }

export default function ReadHoldingRegistersModal({ open, onClose, hosts, push }: { open: boolean; onClose: () => void; hosts: Host[]; push: (lvl: any, text: string) => void }) {
  const [selected, setSelected] = useState('')
  const [addr, setAddr] = useState(0)
  const [len, setLen] = useState(1)
  const [loading, setLoading] = useState(false)
  const [fmt, setFmt] = useState<'hex' | 'dec' | 'oct' | 'bin'>('dec')
  const [history, setHistory] = useState<Array<{ id: string; ts: number; unitId?: number; values: number[]; hostId: string; ip?: string; port?: number; addr: number; len: number }>>([])
  const selectedHost = useMemo(() => hosts.find(h => h.id === selected), [hosts, selected])

  // column width state kept (for Table width hints)
  const [colWidths, setColWidths] = useState<number[]>([160, 110, 140, 80, 80, 520])
  const dragInfo = useRef<{ idx: number; startX: number; startW: number } | null>(null)
  const MIN_W = 80
  const startResize = (idx: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    dragInfo.current = { idx, startX: e.clientX, startW: colWidths[idx] }
    const onMove = (ev: MouseEvent) => {
      if (!dragInfo.current) return
      const dx = ev.clientX - dragInfo.current.startX
      const next = [...colWidths]
      next[dragInfo.current.idx] = Math.max(MIN_W, dragInfo.current.startW + dx)
      setColWidths(next)
    }
    const onUp = () => { dragInfo.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const totalTableWidth = colWidths.reduce((a, b) => a + b, 0)

  useEffect(() => { if (open) setHistory([]) }, [open])

  const formatValue = (v: number) => (
    fmt === 'hex' ? '0x' + v.toString(16).toUpperCase() :
    fmt === 'oct' ? '0o' + v.toString(8) :
    fmt === 'bin' ? '0b' + v.toString(2) : String(v)
  )

  async function doRead() {
    if (!selected) { push('warning', '請先選擇主機'); return }
    if (!selectedHost?.connected) { push('warning', '目標主機未連線'); return }
    if (!Number.isFinite(addr) || addr < 0 || addr > 65535) { push('warning', '起始位址需為 0~65535 的整數'); return }
    if (!Number.isFinite(len) || len <= 0 || len > 125) { push('warning', '讀取長度需為 1~125 的整數'); return }
    if (addr + len - 1 > 65535) { push('warning', '位址加上長度超出範圍 (最後位址需 ≤ 65535)'); return }
    try {
      setLoading(true)
      const r = await readHoldingRegisters(selected, Number(addr), Number(len))
      if (!r.success || !Array.isArray(r.data)) throw new Error('讀取失敗')
      const values = r.data
      setHistory(h => [{ id: (globalThis.crypto as any)?.randomUUID?.() || String(Date.now()), ts: Date.now(), unitId: selectedHost?.unitId, values, hostId: selected, ip: selectedHost?.ip, port: selectedHost?.port, addr: Number(addr), len: Number(len) }, ...h])
      push('success', `讀取成功：${selected} @${addr} x${len}`)
    } catch (e: any) {
      push('error', e?.message ? `讀取失敗：${e.message}` : '讀取失敗')
    } finally { setLoading(false) }
  }

  const latest = history[0]
  const copyLatest = async () => {
    if (!latest) return
    const text = latest.values.map(formatValue).join(', ')
    try { await navigator.clipboard.writeText(text); push('success', '已複製到剪貼簿') }
    catch { push('warning', '無法存取剪貼簿') }
  }

  return (
    <GlassModal isOpen={open} onClose={onClose} size="max-w-[92vw]" maxHeight="max-h-[62vh]" contentMaxHeight="max-h-[calc(62vh-56px)]" baseVh={62}>
      <div className="grid-left-340">
        <div className="stack text-sm">
          <h3 className="m-0 text-gray-900">讀取保持暫存器</h3>
          <div className="text-muted">請選擇目標主機、起始位址與讀取長度後執行讀取（Function 0x03）。</div>
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
            {selected && (
              <div className="text-muted">目前狀態：{selectedHost?.connected ? '已連線' : '未連線'}，站號：{selectedHost?.unitId ?? '—'}</div>
            )}
            <h4 className="m-0 mt-2 text-gray-900">讀取參數</h4>
            <div className="form__grid">
              <div className="form-group">
                <label>起始位址</label>
                <input type="number" value={addr} onChange={e => setAddr(Number(e.target.value))} className="control--sm" />
                <div className="hint">對應 function code 0x03 的起始位址</div>
              </div>
              <div className="form-group">
                <label>讀取長度</label>
                <input type="number" value={len} onChange={e => setLen(Number(e.target.value))} className="control--sm" />
                <div className="hint">一次讀取的 registers 數量</div>
              </div>
            </div>
            <div className="form__actions">
              <button className="btn" onClick={doRead} disabled={loading || !selected || !selectedHost?.connected}>讀取</button>
            </div>
          </div>
        </div>
        <div className="stack min-w-0 flex flex-col h-full">
          <div className="row justify-between">
            <div className="row gap-1-5">
              <button className={`btn btn--sm ${fmt==='hex' ? '' : 'btn--outline'}`} onClick={() => setFmt('hex')} disabled={!latest}>十六進位</button>
              <button className={`btn btn--sm ${fmt==='dec' ? '' : 'btn--outline'}`} onClick={() => setFmt('dec')} disabled={!latest}>十進位</button>
              <button className={`btn btn--sm ${fmt==='oct' ? '' : 'btn--outline'}`} onClick={() => setFmt('oct')} disabled={!latest}>八進位</button>
              <button className={`btn btn--sm ${fmt==='bin' ? '' : 'btn--outline'}`} onClick={() => setFmt('bin')} disabled={!latest}>二進位</button>
              <button className="btn btn--sm btn--outline" onClick={copyLatest} disabled={!latest}>複製</button>
            </div>
          </div>
          <CardTableContainer>
            {(() => {
              const columns = [
                { title: '時間', dataIndex: 'ts', key: 'ts', width: 160, render: (v: number) => new Date(v).toLocaleString() },
                { title: 'ID', dataIndex: 'hostId', key: 'hostId', width: 110 },
                { title: 'IP', dataIndex: 'ip', key: 'ip', width: 160 },
                { title: 'Port', dataIndex: 'port', key: 'port', width: 90 },
                { title: '站號', dataIndex: 'unitId', key: 'unitId', width: 90 },
                { title: '內容', dataIndex: 'values', key: 'values', width: 100, render: (arr: number[]) => (
                  <span className="pre-wrap break-words font-mono block overflow-hidden" style={{ textOverflow: 'ellipsis' }}>
                    {Array.isArray(arr) ? arr.map(v => formatValue(v)).join(', ') : ''}
                  </span>
                ) },
              ];
              return (
                <AutoHeightTable
                  columns={columns as any}
                  dataSource={history as any}
                  rowKey={(r: any) => r.id}
                  resizableColumns={true}
                  size="small"
                />
              )
            })()}
          </CardTableContainer>
        </div>
      </div>
    </GlassModal>
  )
}

// --- helpers to make table body height follow the card height ---
function CardTableContainer({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [bodyHeight, setBodyHeight] = useState<number>(240)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      const styles = getComputedStyle(el)
      const padY = parseFloat(styles.paddingTop || '0') + parseFloat(styles.paddingBottom || '0')
      // 預留一點空間避免溢位（例如邊框等），以 6px 緩衝
      const next = Math.max(100, Math.floor(rect.height - padY - 6))
      setBodyHeight(next)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    // 初次量測
    measure()
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  return (
    <div ref={ref} className="card flex-1 min-h-0 overflow-hidden w-full">
      {React.Children.map(children, (child: any) => (
        child && child.type === AutoHeightTable
          ? React.cloneElement(child, { scroll: { ...(child.props.scroll || {}), y: bodyHeight } })
          : child
      ))}
    </div>
  )
}

function AutoHeightTable(props: any) {
  return <Table {...props} />
}
