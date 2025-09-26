import { useEffect, useState } from 'react'
import HostsPanel from './ui/hosts/HostsPanel'
import Navbar from './ui/layout/Navbar'
import { MessagesProvider } from './contexts/MessagesContext'

function App() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])

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
      <div className="app-container">
        <header className="app-header" style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center' }}>Modbus TCP/IP 目前主機連線狀態</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={connectClick}>{selectedIds.length > 0 ? '批量連線' : '全部連線'}</button>
            <button className="btn" onClick={disconnectClick}>{selectedIds.length > 0 ? '批量斷線' : '全部斷線'}</button>
            <button className="btn" style={{ alignSelf: 'stretch', height: '100%' }} onClick={() => window.dispatchEvent(new Event('hosts:add'))}>新增主機</button>
          </div>
        </header>
        <main className="app-main">
          <HostsPanel />
        </main>
      </div>
    </MessagesProvider>
  )
}

export default App
