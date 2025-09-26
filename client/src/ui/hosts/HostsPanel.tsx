import { useEffect, useMemo, useState } from 'react'
import { useHosts } from './useHosts'
import Modal from '../shared/Modal'
import HostsManager from './HostsManager'
import { connectHost, disconnectHost } from '../../api/hosts/connections'

type SortKey = 'id' | 'ip' | 'port' | 'unitId' | 'connected'

export default function HostsPanel() {
  const { hosts, loading, error } = useHosts({ pollMs: 2000 })
  const [openManager, setOpenManager] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('id')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [editInitial, setEditInitial] = useState<{ id: string; ip: string; port: number; unitId: number } | undefined>(undefined)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    const arr = [...hosts]
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      let va: any = a[sortKey as keyof typeof a]
      let vb: any = b[sortKey as keyof typeof b]
      // 字串與數字/布林排序處理
      if (sortKey === 'connected') {
        va = a.connected ? 1 : 0
        vb = b.connected ? 1 : 0
      }
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir
      return ((va ?? 0) - (vb ?? 0)) * dir
    })
    return arr
  }, [hosts, sortKey, sortDir])

  const th = (label: string, key: SortKey) => (
    <th
      onClick={() => toggleSort(key)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      title={`依 ${label} 排序`}
    >
      {label} {sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )

  // 來自 App.tsx 的全域事件，開啟新增主機 modal
  useEffect(() => {
    const handler = () => { setEditInitial(undefined); setOpenManager(true) }
    window.addEventListener('hosts:add', handler)
    return () => window.removeEventListener('hosts:add', handler)
  }, [])

  // 將目前選取狀態回報給 App 以切換按鈕文字（全部/批量）
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('hosts:selected', { detail: { ids: Array.from(selectedIds) } }))
  }, [selectedIds])

  // 批量操作：連線與斷線
  const batchConnect = async (ids: string[]) => {
    const toConnect = hosts.filter(h => ids.includes(h.id) && !h.connected && h.ip && h.port && h.unitId)
    if (toConnect.length === 0) return
    await Promise.allSettled(toConnect.map(h =>
      connectHost({ id: h.id, ip: String(h.ip), port: Number(h.port), unitId: Number(h.unitId) })
    ))
    window.dispatchEvent(new Event('hosts:changed'))
  }

  const batchDisconnect = async (ids: string[]) => {
    const toDisconnected = hosts.filter(h => ids.includes(h.id) && h.connected)
    if (toDisconnected.length === 0) return
    await Promise.allSettled(toDisconnected.map(h => disconnectHost(h.id)))
    window.dispatchEvent(new Event('hosts:changed'))
  }

  // 監聽 App 的批量/全部事件
  useEffect(() => {
    const onConnectBatch = (e: any) => {
      const ids: string[] | undefined = e?.detail?.ids
      if (ids && ids.length) batchConnect(ids)
    }
    const onDisconnectBatch = (e: any) => {
      const ids: string[] | undefined = e?.detail?.ids
      if (ids && ids.length) batchDisconnect(ids)
    }
    const onConnectAll = () => batchConnect(hosts.map(h => h.id))
    const onDisconnectAll = () => batchDisconnect(hosts.map(h => h.id))

    window.addEventListener('hosts:connect-batch', onConnectBatch as any)
    window.addEventListener('hosts:disconnect-batch', onDisconnectBatch as any)
    window.addEventListener('hosts:connect-all', onConnectAll)
    window.addEventListener('hosts:disconnect-all', onDisconnectAll)
    return () => {
      window.removeEventListener('hosts:connect-batch', onConnectBatch as any)
      window.removeEventListener('hosts:disconnect-batch', onDisconnectBatch as any)
      window.removeEventListener('hosts:connect-all', onConnectAll)
      window.removeEventListener('hosts:disconnect-all', onDisconnectAll)
    }
  }, [hosts])

  // 勾選邏輯
  const allOnPageSelected = sorted.length > 0 && sorted.every(h => selectedIds.has(h.id))
  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(sorted.map(h => h.id)))
    else setSelectedIds(new Set())
  }
  const toggleSelect = (id: string, checked: boolean) => {
    const next = new Set(selectedIds)
    if (checked) next.add(id)
    else next.delete(id)
    setSelectedIds(next)
  }

  return (
    <div className="card">
      <h3 style={{ margin: 0 }}>所有主機狀態</h3>
      {error && <p style={{ color: '#ff8080' }}>{error}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  aria-label="全選"
                  checked={allOnPageSelected}
                  onChange={e => toggleSelectAll(e.currentTarget.checked)}
                />
              </th>
              {th('ID', 'id')}
              {th('IP', 'ip')}
              {th('Port', 'port')}
              {th('Unit ID', 'unitId')}
              {th('狀態', 'connected')}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && !loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#777' }}>尚無主機</td></tr>
            ) : sorted.map(h => (
              <tr key={h.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`選取 ${h.id}`}
                    checked={selectedIds.has(h.id)}
                    onChange={e => toggleSelect(h.id, e.currentTarget.checked)}
                  />
                </td>
                <td>{h.id}</td>
                <td>{h.ip}</td>
                <td>{h.port}</td>
                <td>{h.unitId}</td>
                <td style={{ color: h.connected ? '#3fb950' : '#ff7b72' }}>{h.connected ? '已連線' : '未連線'}</td>
                <td>
                  <div className="row" style={{ gap: 2 }}>
                    <button
                      className="icon-btn icon-btn--sm icon-btn--primary"
                      title="編輯"
                      aria-label="編輯"
                      onClick={() => { setEditInitial({ id: h.id, ip: String(h.ip||''), port: Number(h.port||0), unitId: Number(h.unitId||1) }); setOpenManager(true) }}
                    >
                      <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button
                      className="icon-btn icon-btn--sm icon-btn--success"
                      title="連線"
                      aria-label="連線"
                      disabled={rowBusy === h.id || !!h.connected}
                      onClick={async () => {
                        if (!h.ip || !h.port || !h.unitId) return
                        try {
                          setRowBusy(h.id)
                          const r = await connectHost({ id: h.id, ip: String(h.ip), port: Number(h.port), unitId: Number(h.unitId) })
                          if (!r.success) throw new Error(r.message)
                        } catch (e) { /* no-op */ }
                        finally {
                          setRowBusy(null)
                          window.dispatchEvent(new Event('hosts:changed'))
                        }
                      }}
                    >
                      <svg viewBox="0 0 24 24"><path d="M6 7l6 6 6-6"/></svg>
                    </button>
                    <button
                      className="icon-btn icon-btn--sm icon-btn--danger"
                      title="斷線"
                      aria-label="斷線"
                      disabled={rowBusy === h.id || !h.connected}
                      onClick={async () => {
                        try {
                          setRowBusy(h.id)
                          const r = await disconnectHost(h.id)
                          if (!('success' in r) || !r.success) throw new Error((r as any).message || '失敗')
                        } catch (e) { /* no-op */ }
                        finally {
                          setRowBusy(null)
                          window.dispatchEvent(new Event('hosts:changed'))
                        }
                      }}
                    >
                      <svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={openManager} title="新增/更新主機" onClose={() => setOpenManager(false)} size="lg">
        <HostsManager showTitle={false} showList={false} initial={editInitial} />
      </Modal>
    </div>
  )
}