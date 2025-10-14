import { useEffect, useState } from 'react'
import ModbusTCP from './pages/ModbusTCP'
import Modbus485 from './pages/Modbus485'

type TabKey = 'tcp' | 'r485'

export default function App() {
  const [msg, setMsg] = useState('')
  const [tab, setTab] = useState<TabKey>('tcp')
  useEffect(() => { setMsg(window?.api?.ping?.() ?? '') }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fb', color: '#1a1a1a' }}>
      <header style={{ background: '#ffffff', borderBottom: '1px solid #eee', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700 }}>Modbus 工具</div>
        <nav style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTab('tcp')} style={{ padding: '6px 12px', background: tab === 'tcp' ? '#e8efff' : '#fff', border: '1px solid #dce3f0' }}>Modbus TCP/IP</button>
          <button onClick={() => setTab('r485')} style={{ padding: '6px 12px', background: tab === 'r485' ? '#e8efff' : '#fff', border: '1px solid #dce3f0' }}>Modbus 485</button>
        </nav>
      </header>
      <main>
        {tab === 'tcp' ? <ModbusTCP /> : <Modbus485 />}
      </main>
      {msg && <div style={{ position: 'fixed', right: 12, bottom: 8, color: '#7a8899', fontSize: 12 }}>preload: {msg}</div>}
    </div>
  )
}
