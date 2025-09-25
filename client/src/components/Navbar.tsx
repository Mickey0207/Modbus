import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { useMessages } from '../contexts/MessagesContext'
import { getStatuses, readHoldingRegisters, writeSingleRegister } from '../features/hosts/api'
import Select from './Select'
import { useHosts } from '../features/hosts/useHosts'

type Host = { id: string; ip?: string; port?: number; unitId?: number; connected: boolean }

export default function Navbar() {
  const { messages, push } = useMessages()
  const latest = messages[0]
  // 使用輪詢每 2 秒更新一次主機狀態，確保彈窗內的「已連線/未連線」即時顯示
  const { hosts, refresh } = useHosts({ pollMs: 2000 })
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
  const [loading, setLoading] = useState(false)
  const [fmt, setFmt] = useState<'hex' | 'dec' | 'oct' | 'bin'>('dec')
  const [history, setHistory] = useState<Array<{ id: string; ts: number; unitId?: number; values: number[]; hostId: string; ip?: string; port?: number; addr: number; len: number }>>([])
  const [chunked, setChunked] = useState(false)
  const [chunkSize, setChunkSize] = useState(20)
  const selectedHost = useMemo(() => hosts.find(h => h.id === selected), [hosts, selected])

  useEffect(() => { if (open) { /* 開啟時重置顯示 */ setHistory([]) } }, [open])

  const formatValue = (v: number) => (
    fmt === 'hex' ? '0x' + v.toString(16).toUpperCase() :
    fmt === 'oct' ? '0o' + v.toString(8) :
    fmt === 'bin' ? '0b' + v.toString(2) : String(v)
  )

  async function doRead() {
    if (!selected) { push('warning', '請先選擇主機'); return }
    if (!selectedHost?.connected) { push('warning', '目標主機未連線'); return }
    if (!Number.isFinite(addr) || addr < 0 || addr > 65535) {
      push('warning', '起始位址需為 0~65535 的整數');
      return
    }
    if (!Number.isFinite(len) || len <= 0 || len > 125) {
      push('warning', '讀取長度需為 1~125 的整數');
      return
    }
    if (addr + len - 1 > 65535) {
      push('warning', '位址加上長度超出範圍 (最後位址需 ≤ 65535)');
      return
    }
    try {
      setLoading(true)
      let values: number[] = []
      const r = await readHoldingRegisters(selected, Number(addr), Number(len))
      if (!r.success || !Array.isArray(r.data)) throw new Error('讀取失敗')
      values = r.data
      setHistory(h => [{ id: crypto.randomUUID?.() || String(Date.now()), ts: Date.now(), unitId: selectedHost?.unitId, values, hostId: selected, ip: selectedHost?.ip, port: selectedHost?.port, addr: Number(addr), len: Number(len) }, ...h])
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
    <Modal open={open} onClose={onClose} size="lg">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 左欄：設定 */}
        <div className="stack">
          <h3 style={{ margin: '0 0 4px', color: '#111' }}>讀取保持暫存器</h3>
          <div className="text-muted">請選擇目標主機、起始位址與讀取長度後執行讀取（Function 0x03）。</div>
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
              <div className="text-muted">目前狀態：{selectedHost?.connected ? '已連線' : '未連線'}，站號：{selectedHost?.unitId ?? '—'}</div>
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
                <div className="hint">一次讀取的 registers 數量</div>
              </div>
            </div>
            <div className="form__actions">
              <button className="btn" onClick={doRead} disabled={loading || !selected || !selectedHost?.connected}>讀取</button>
            </div>
          </div>
        </div>

        {/* 右欄：結果（表格） */}
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, color: '#111' }}>讀取結果</h3>
            <div className="row" style={{ gap: 6 }}>
              <button className={`btn btn--sm ${fmt==='hex' ? '' : 'btn--outline'}`} onClick={() => setFmt('hex')} disabled={!latest}>十六進位</button>
              <button className={`btn btn--sm ${fmt==='dec' ? '' : 'btn--outline'}`} onClick={() => setFmt('dec')} disabled={!latest}>十進位</button>
              <button className={`btn btn--sm ${fmt==='oct' ? '' : 'btn--outline'}`} onClick={() => setFmt('oct')} disabled={!latest}>八進位</button>
              <button className={`btn btn--sm ${fmt==='bin' ? '' : 'btn--outline'}`} onClick={() => setFmt('bin')} disabled={!latest}>二進位</button>
              <button className="btn btn--sm btn--outline" onClick={copyLatest} disabled={!latest}>複製</button>
            </div>
          </div>
          <div className="card" style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 160 }}>時間</th>
                  <th style={{ width: 100 }}>ID</th>
                  <th style={{ width: 140 }}>IP</th>
                  <th style={{ width: 80 }}>Port</th>
                  <th style={{ width: 80 }}>站號</th>
                  <th>內容</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#777' }}>尚未讀取</td></tr>
                ) : history.map(item => (
                  <tr key={item.id}>
                    <td>{new Date(item.ts).toLocaleString()}</td>
                    <td>{item.hostId}</td>
                    <td>{item.ip ?? '—'}</td>
                    <td>{item.port ?? '—'}</td>
                    <td>{item.unitId ?? '—'}</td>
                    <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
                      {item.values.map(v => formatValue(v)).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

// 已移除「主機管理」按鈕與對應彈窗，改由 HostsPanel 提供

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
