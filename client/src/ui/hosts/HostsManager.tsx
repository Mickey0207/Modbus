import { useEffect, useMemo, useState } from 'react'
import { listRegistry, upsertHost, deleteHost, connectAll, disconnectAll } from '../../api/hosts/registry'
import { connectHost, disconnectHost } from '../../api/hosts/connections'
import { getStatuses } from '../../api/hosts/connections'
import { useMessages } from '../../contexts/MessagesContext'

export default function HostsManager({ showTitle = true, showList = true, initial }: { showTitle?: boolean; showList?: boolean; initial?: { id: string; ip: string; port: number; unitId: number } }) {
  const { push } = useMessages()
  const [hosts, setHosts] = useState<any[]>([])
  const [statuses, setStatuses] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState(initial ?? { id: '', ip: '', port: 502, unitId: 1 })

  const merged = useMemo(() => {
    const map: Record<string, any> = {}
    for (const h of hosts) map[h.id] = { ...h, connected: false }
    for (const s of statuses) map[s.id] = { ...(map[s.id] || {}), ...s }
    return Object.values(map)
  }, [hosts, statuses])

  async function refresh() {
    try {
      setLoading(true)
      const [reg, stat] = await Promise.all([listRegistry(), getStatuses()])
      if (!reg.success) throw new Error('讀取清單失敗')
      if (!stat.success) throw new Error('讀取狀態失敗')
      setHosts(reg.data)
      setStatuses(stat.data)
    } catch (e: any) { push('error', e.message || String(e)) }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])
  useEffect(() => {
    if (initial) setForm(initial)
  }, [initial])

  async function onSave() {
    try {
      setLoading(true)
      const res = await upsertHost({ ...form, port: Number(form.port), unitId: Number(form.unitId) } as any)
      if (!res.success) throw new Error(res.message)
      push('success', `已儲存 ${form.id}`)
      setForm({ id: '', ip: '', port: 502, unitId: 1 })
      await refresh()
      window.dispatchEvent(new Event('hosts:changed'))
    } catch (e: any) { push('error', e.message || String(e)) } finally { setLoading(false) }
  }

  async function onDelete(id: string) {
    try {
      setLoading(true)
      await deleteHost(id)
      push('success', `已刪除 ${id}`)
      await refresh()
      window.dispatchEvent(new Event('hosts:changed'))
    } catch (e: any) { push('error', e.message || String(e)) } finally { setLoading(false) }
  }

  async function onConnect(id: string, ip: string, port: number, unitId: number) {
    try {
      setLoading(true)
      const r = await connectHost({ id, ip, port, unitId })
      if (!r.success) throw new Error(r.message)
      await refresh()
      window.dispatchEvent(new Event('hosts:changed'))
    } catch (e: any) { push('error', e.message || String(e)) } finally { setLoading(false) }
  }

  async function onDisconnect(id: string) {
    try {
      setLoading(true)
      const r = await disconnectHost(id)
      if (!('success' in r) || !r.success) throw new Error((r as any).message || '失敗')
      await refresh()
      window.dispatchEvent(new Event('hosts:changed'))
    } catch (e: any) { push('error', e.message || String(e)) } finally { setLoading(false) }
  }

  async function onConnectAll() { setLoading(true); try { await connectAll(); await refresh(); window.dispatchEvent(new Event('hosts:changed')) } catch (e:any){ push('error', String(e)) } finally { setLoading(false) } }
  async function onDisconnectAll() { setLoading(true); try { await disconnectAll(); await refresh(); window.dispatchEvent(new Event('hosts:changed')) } catch (e:any){ push('error', String(e)) } finally { setLoading(false) } }

  return (
    <div className="container" style={{ padding: 16 }}>
      {showTitle && <h2 style={{ margin: '8px 0 12px' }}>主機管理</h2>}

      <div className="card stack" style={{ marginBottom: 16 }}>
        <h5 style={{ margin: 0 }}>新增/更新主機</h5>
        <div className="form">
          <div className="form__grid">
            <div className="form-group">
              <label>主機代號</label>
              <input value={form.id} onChange={e=>setForm({ ...form, id: e.target.value })} placeholder="PLC-A" />
            </div>
            <div className="form-group">
              <label>IP</label>
              <input value={form.ip} onChange={e=>setForm({ ...form, ip: e.target.value })} placeholder="192.168.1.10" />
            </div>
            <div className="form-group">
              <label>Port</label>
              <input type="number" value={form.port} onChange={e=>setForm({ ...form, port: Number(e.target.value) })} />
            </div>
            <div className="form-group">
              <label>Unit Id</label>
              <input type="number" value={form.unitId} onChange={e=>setForm({ ...form, unitId: Number(e.target.value) })} />
            </div>
          </div>
          <div className="form__actions">
            <button className="btn btn--lg" onClick={onSave} disabled={loading || !form.id || !form.ip}>儲存</button>
          </div>
        </div>
      </div>

      {showList && (
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h5 style={{ margin: 0 }}>已註冊主機</h5>
          <div className="row">
            <button className="btn btn--outline" onClick={onConnectAll} disabled={loading}>全部連線</button>
            <button className="btn btn--outline btn--neutral" onClick={onDisconnectAll} disabled={loading}>全部斷線</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>主機代號</th>
                <th>IP</th>
                <th>Port</th>
                <th>Unit Id</th>
                <th>狀態</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {merged.map((h:any) => (
                <tr key={h.id}>
                  <td><strong>{h.id}</strong></td>
                  <td>{h.ip}</td>
                  <td>{h.port}</td>
                  <td>{h.unitId}</td>
                  <td>
                    {h.connected ? (
                      <span className="badge badge--ok">已連線</span>
                    ) : (
                      <span className="badge badge--err">未連線</span>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <button className="btn btn--sm" onClick={() => onConnect(h.id, h.ip, h.port, h.unitId)} disabled={loading}>連線</button>
                      <button className="btn btn--sm btn--neutral" onClick={() => onDisconnect(h.id)} disabled={loading}>斷線</button>
                      <button className="btn btn--sm btn--danger" onClick={() => onDelete(h.id)} disabled={loading}>刪除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {merged.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: '#777' }}>尚無主機</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  )
}