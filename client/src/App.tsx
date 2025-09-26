import { useEffect, useState } from 'react'
import HostsPanel from './ui/hosts/HostsPanel'
import Navbar from './ui/layout/Navbar'
import Sidebar from './ui/layout/Sidebar'
import { useMessages } from './contexts/MessagesContext'
import { MessagesProvider } from './contexts/MessagesContext'

type PageKey = 'status' | 'logs'

function App() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [page, setPage] = useState<PageKey>('status')
  const [sidebarExpanded, setSidebarExpanded] = useState(false)

  useEffect(() => {
    const handler = (e: any) => setSelectedIds(e?.detail?.ids || [])
    window.addEventListener('hosts:selected', handler as any)
    return () => window.removeEventListener('hosts:selected', handler as any)
  }, [])

  const connectClick = () => {
    if (selectedIds.length > 0) {
      window.dispatchEvent(new CustomEvent('hosts:connect-batch', { detail: { ids: selectedIds } }))
    } else {
      window.dispatchEvent(new Event('hosts:connect-all'))
    }
  }
  const disconnectClick = () => {
    if (selectedIds.length > 0) {
      window.dispatchEvent(new CustomEvent('hosts:disconnect-batch', { detail: { ids: selectedIds } }))
    } else {
      window.dispatchEvent(new Event('hosts:disconnect-all'))
    }
  }

  return (
    <MessagesProvider>
      <Navbar />
      {/* Full-width row: sidebar flush left, content on the right within padded container */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 16, position: 'relative' }}>
        <Sidebar current={page} onNavigate={setPage} onExpandChange={setSidebarExpanded} />
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <div className="app-container">
            <header className="app-header" style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'space-between', gap: 12 }}>
              <h1 style={{ margin: 0, display: 'flex', alignItems: 'center' }}>Modbus TCP/IP 目前主機連線狀態</h1>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={connectClick}>{selectedIds.length > 0 ? '批量連線' : '全部連線'}</button>
                <button className="btn" onClick={disconnectClick}>{selectedIds.length > 0 ? '批量斷線' : '全部斷線'}</button>
                <button className="btn" style={{ alignSelf: 'stretch', height: '100%' }} onClick={() => window.dispatchEvent(new Event('hosts:add'))}>新增主機</button>
              </div>
            </header>
            <main className="app-main" style={{ marginTop: 8 }}>
              {page === 'status' && <HostsPanel />}
              {page === 'logs' && <LogsView />}
            </main>
          </div>
          {sidebarExpanded && (
            <div
              aria-hidden
              style={{
                position: 'absolute', inset: 0,
                borderRadius: 0,
                background: 'rgba(255,255,255,0.35)',
                backdropFilter: 'blur(4px) saturate(130%)',
                WebkitBackdropFilter: 'blur(4px) saturate(130%)',
                pointerEvents: 'none',
                transition: 'opacity 160ms ease',
              }}
            />
          )}
        </div>
      </div>
    </MessagesProvider>
  )
}

export default App

function LogsView() {
  const { messages } = useMessages()
  const items = (messages || []).slice(0, 200)
  const levelBadge = (lvl: string) => lvl==='success' ? 'badge--success' : lvl==='error' ? 'badge--err' : lvl==='warning' ? 'badge--warn' : 'badge--info'
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>系統資訊</h3>
      <div className="card" style={{ maxHeight: '70vh', overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 160 }}>時間</th>
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
    </div>
  )
}
