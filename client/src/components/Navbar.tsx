import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { useMessages } from '../contexts/MessagesContext'
import { getStatuses, readHoldingRegisters, writeSingleRegister } from '../features/hosts/api'
import HostsManager from '../features/hosts/HostsManager'
import Select from './Select'
import { useHosts } from '../features/hosts/useHosts'

type Host = { id: string; ip?: string; port?: number; unitId?: number; connected: boolean }

export default function Navbar() {
  const { messages, push } = useMessages()
  const latest = messages[0]
  // 使用輪詢每 2 秒更新一次主機狀態，確保彈窗內的「已連線/未連線」即時顯示
  const { hosts, refresh } = useHosts({ pollMs: 2000 })
  const [openHosts, setOpenHosts] = useState(false)
  const [openRead, setOpenRead] = useState(false)
  const [openWrite, setOpenWrite] = useState(false)
  const [openLogs, setOpenLogs] = useState(false)
  const [loading, setLoading] = useState(false)

  const connectedCount = useMemo(() => hosts.filter(h => h.connected).length, [hosts])

  useEffect(() => { refresh() }, [refresh])

  return (
    <div className="modbus-navbar">
      <div className="navbar-left">
        <a className="navbar-brand" href="#">Modbus Tool</a>
        <div className="navbar-title">主機：{connectedCount}/{hosts.length} 已連線</div>
        <div className="navbar-actions">
          <button className="navbar-btn" onClick={() => setOpenHosts(true)}>主機管理</button>
          <button className="navbar-btn primary" onClick={() => setOpenRead(true)}>讀取</button>
          <button className="navbar-btn" onClick={() => setOpenWrite(true)}>寫入</button>
        </div>
      </div>
      <div className="navbar-right">
        <div className="system-messages" onClick={() => setOpenLogs(true)}>
          <div className="message-display message-info">
            <span className="latest-message">{latest ? `${new Date(latest.ts).toLocaleTimeString()} [${latest.level}] ${latest.text}` : '—'}</span>
          </div>
        </div>
      </div>
      <HostsModal open={openHosts} onClose={() => setOpenHosts(false)} />
      <ReadModal open={openRead} onClose={() => setOpenRead(false)} hosts={hosts} push={push} />
      <WriteModal open={openWrite} onClose={() => setOpenWrite(false)} hosts={hosts} push={push} />
      <LogsModal open={openLogs} onClose={() => setOpenLogs(false)} />
    </div>
  )
}
function ReadModal({ open, onClose, hosts, push }: { open: boolean; onClose: () => void; hosts: Host[]; push: (lvl: any, text: string) => void }) {
  const [selected, setSelected] = useState('')
  const [addr, setAddr] = useState(0)
  const [len, setLen] = useState(1)
  const [result, setResult] = useState<number[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'table' | 'list'>('table')
  const [fmt, setFmt] = useState<'dec' | 'hex'>('dec')
  const selectedHost = useMemo(() => hosts.find(h => h.id === selected), [hosts, selected])

  useEffect(() => { if (open) { setResult(null) } }, [open])

  async function doRead() {
    if (!selected) { push('warning', '請先選擇主機'); return }
    try {
      setLoading(true)
      const res = await readHoldingRegisters(selected, Number(addr), Number(len))
      if (!res.success) throw new Error('讀取失敗')
      setResult(res.data)
      push('success', `讀取成功：${selected} @${addr} x${len}`)
    } catch (e: any) {
      push('error', e.message || String(e))
    } finally { setLoading(false) }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="stack">
        <h3 style={{ margin: '0 0 4px', color: '#111' }}>讀取保持暫存器（指定主機）</h3>
        <div className="text-muted">請先選擇目標主機，再進行讀取或寫入操作。</div>

        <div className="form">
          <div className="form-group">
            <label>目標主機</label>
            <Select
              value={selected}
              onChange={setSelected}
              options={[{ value: '', label: <span className="text-muted">— 請選擇 —</span> }, ...hosts.map(h => ({
                value: h.id,
                label: (<span><strong>{h.id}</strong> <span className={`badge ${h.connected ? 'badge--ok' : 'badge--err'}`} style={{ marginLeft: 6 }}>{h.connected ? '已連線' : '未連線'}</span></span>)
              }))]}
            />
          </div>
          {selected && (
            <div className="text-muted">目前狀態：{selectedHost?.connected ? '已連線' : '未連線'}</div>
          )}
          <h4 style={{ margin: '4px 0', color: '#111' }}>讀取參數</h4>
          <div className="form__grid">
            <div className="form-group">
              <label>起始位址</label>
              <input type="number" value={addr} onChange={e => setAddr(Number(e.target.value))} />
              <div className="hint">對應 function code 0x03 的起始位址</div>
            </div>
            <div className="form-group">
              <label>讀取長度</label>
              <input type="number" value={len} onChange={e => setLen(Number(e.target.value))} />
              <div className="hint">一次讀取的 registries 數量</div>
            </div>
          </div>
          <div className="form__actions">
            <button className="btn" onClick={doRead} disabled={loading || !selected || !selectedHost?.connected}>讀取</button>
          </div>
          <div className="card" style={{ marginTop: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="row">
                <button className={`btn btn--sm ${view==='table' ? '' : 'btn--outline'}`} onClick={() => setView('table')} disabled={!Array.isArray(result)}>表格</button>
                <button className={`btn btn--sm ${view==='list' ? '' : 'btn--outline'}`} onClick={() => setView('list')} disabled={!Array.isArray(result)}>清單</button>
              </div>
              <div className="row">
                <button className={`btn btn--sm ${fmt==='dec' ? '' : 'btn--outline'}`} onClick={() => setFmt('dec')} disabled={!Array.isArray(result)}>十進位</button>
                <button className={`btn btn--sm ${fmt==='hex' ? '' : 'btn--outline'}`} onClick={() => setFmt('hex')} disabled={!Array.isArray(result)}>十六進位</button>
                <button
                  className="btn btn--sm btn--outline"
                  onClick={async () => {
                    if (!Array.isArray(result)) return
                    const values = result.map(v => fmt==='hex' ? '0x' + v.toString(16).toUpperCase() : String(v))
                    const text = view === 'table'
                      ? ['address,value', ...values.map((v, i) => `${addr + i},${v}`)].join('\n')
                      : values.join(', ')
                    try { await navigator.clipboard.writeText(text); push('success', '已複製到剪貼簿') }
                    catch { push('warning', '無法存取剪貼簿') }
                  }}
                  disabled={!Array.isArray(result) || result.length === 0}
                >複製</button>
              </div>
            </div>

            {!Array.isArray(result) || result.length === 0 ? (
              <div className="text-muted">尚未讀取</div>
            ) : view === 'table' ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>位址</th>
                      <th>數值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.map((v, i) => (
                      <tr key={i}>
                        <td>{addr + i}</td>
                        <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
                          {fmt==='hex' ? ('0x' + v.toString(16).toUpperCase()) : v}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
                {result.map(v => fmt==='hex' ? ('0x' + v.toString(16).toUpperCase()) : String(v)).join(', ')}
              </pre>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function WriteModal({ open, onClose, hosts, push }: { open: boolean; onClose: () => void; hosts: Host[]; push: (lvl: any, text: string) => void }) {
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
    <Modal open={open} onClose={onClose}>
      <div className="stack">
        <h3 style={{ margin: '0 0 4px', color: '#111' }}>寫入單一保持暫存器（指定主機）</h3>
        <div className="text-muted">請選擇主機並輸入位址與數值後執行寫入。</div>
        <div className="form">
          <div className="form-group">
            <label>目標主機</label>
            <Select
              value={selected}
              onChange={setSelected}
              options={[{ value: '', label: <span className="text-muted">— 請選擇 —</span> }, ...hosts.map(h => ({
                value: h.id,
                label: (<span><strong>{h.id}</strong> <span className={`badge ${h.connected ? 'badge--ok' : 'badge--err'}`} style={{ marginLeft: 6 }}>{h.connected ? '已連線' : '未連線'}</span></span>)
              }))]}
            />
          </div>
          {selected && (
            <div className="text-muted">目前狀態：{selectedHost?.connected ? '已連線' : '未連線'}</div>
          )}
          <h4 style={{ margin: '8px 0 4px', color: '#111' }}>寫入參數</h4>
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
    </Modal>
  )
}

function HostsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="主機管理" onClose={onClose} size="lg">
      <HostsManager showTitle={false} />
    </Modal>
  )
}

function LogsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { messages } = useMessages()
  const [filter, setFilter] = useState<'all' | 'info' | 'success' | 'warning' | 'error'>('all')
  const items = (messages || []).slice(0, 100).filter(m => filter==='all' ? true : m.level===filter)
  const levelBadge = (lvl: string) => lvl==='success' ? 'badge--success' : lvl==='error' ? 'badge--err' : lvl==='warning' ? 'badge--warn' : 'badge--info'
  return (
    <Modal open={open} title="系統資訊" onClose={onClose} size="lg">
      <h3 style={{ marginTop: 0, color: '#111' }}>系統資訊（最多 100 筆）</h3>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="row">
          <label style={{ fontSize: 13, color: '#555' }}>過濾：</label>
          <select className="select" value={filter} onChange={e=>setFilter(e.target.value as any)}>
            <option value="all">全部</option>
            <option value="info">資訊</option>
            <option value="success">成功</option>
            <option value="warning">警告</option>
            <option value="error">錯誤</option>
          </select>
        </div>
      </div>
      <div className="card" style={{ maxHeight: 480, overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 140 }}>時間</th>
              <th style={{ width: 100 }}>等級</th>
              <th>內容</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: '#777' }}>目前沒有訊息</td></tr>
            ) : items.map(m => (
              <tr key={m.id}>
                <td>{new Date(m.ts).toLocaleString()}</td>
                <td><span className={`badge ${levelBadge(m.level)}`}>{m.level}</span></td>
                <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
