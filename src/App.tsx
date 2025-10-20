import { useEffect, useMemo, useRef, useState } from 'react'
import Unified from './pages/Unified'

type LogItem = { id: string; tag: string; tx: string; rx: string; t: number }

export default function App() {
  const [msg, setMsg] = useState('')
  useEffect(() => { setMsg(window?.api?.ping?.() ?? '') }, [])

  // Header marquee logs
  const [logs, setLogs] = useState<LogItem[]>([])
  const [showLogPanel, setShowLogPanel] = useState(false)
  const [marqIdx, setMarqIdx] = useState(0)
  const colors = useMemo(() => ['#2563eb','#16a34a','#b45309','#7c3aed','#dc2626','#0d9488','#9333ea','#1e293b'], [])

  useEffect(() => {
    const onLog = (e: any) => {
      const d = e?.detail || {}
      const item: LogItem = { id: `${d.t}-${Math.random().toString(36).slice(2,6)}`, tag: d.tag||'', tx: d.tx||'', rx: d.rx||'', t: d.t||Date.now() }
      setLogs(prev => [item, ...prev].slice(0,200))
    }
    window.addEventListener('modbus:log', onLog as any)
    return () => window.removeEventListener('modbus:log', onLog as any)
  }, [])

  useEffect(() => {
    if (!logs.length) return
    const h = setInterval(() => setMarqIdx(i => (i+1) % logs.length), 2500)
    return () => clearInterval(h)
  }, [logs.length])

  const current = logs[marqIdx]
  const curColor = current ? colors[marqIdx % colors.length] : '#64748b'

  // 頂部導航已移除；固定顯示 Unified 頁面

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fb', color: '#1a1a1a' }}>
      <header style={{ background: '#ffffff', borderBottom: '1px solid #eee', padding: 0 }}>
        {/* Marquee bar */}
        <div onClick={() => setShowLogPanel(v => !v)} style={{ cursor:'pointer', userSelect:'none', padding:'6px 12px', background:'#0f172a', color:'#e2e8f0', borderTop:'1px solid #0b1220', borderBottom: showLogPanel? '1px solid #1f2937' : '1px solid #0b1220' }}>
          {current ? (
            <div style={{ display:'grid', gap:2 }}>
              <div style={{ display:'flex', gap:8, alignItems:'center', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                <span style={{ display:'inline-block', width:8, height:8, background:curColor, borderRadius:2 }} />
                <span style={{ color:'#bae6fd' }}>[{current.tag}] TX</span>
                <span style={{ color:'#93c5fd' }}>{current.tx}</span>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                <span style={{ display:'inline-block', width:8, height:8, background:curColor, borderRadius:2, opacity:.7 }} />
                <span style={{ color:'#bbf7d0' }}>[{current.tag}] RX</span>
                <span style={{ color:'#a7f3d0' }}>{current.rx}</span>
              </div>
            </div>
          ) : (
            <div style={{ color:'#94a3b8', fontSize:12 }}>點擊以展開日誌（尚無紀錄）</div>
          )}
        </div>
        {/* Expanded panel */}
        {showLogPanel && (
          <div style={{ background:'#0b1220', color:'#e2e8f0', maxHeight:240, overflow:'auto', borderTop:'1px solid #1f2937', padding:'8px 12px' }}>
            {logs.length===0 ? (
              <div style={{ color:'#94a3b8' }}>尚無日誌</div>
            ) : (
              logs.map((l, idx) => {
                const c = colors[idx % colors.length]
                const date = new Date(l.t)
                const ts = `${date.toLocaleTimeString()} .${String(date.getMilliseconds()).padStart(3,'0')}`
                return (
                  <div key={l.id} style={{ borderLeft:`3px solid ${c}`, paddingLeft:8, marginBottom:8 }}>
                    <div style={{ display:'flex', gap:8, alignItems:'baseline' }}>
                      <span style={{ color:'#94a3b8', fontSize:11 }}>{ts}</span>
                      <span style={{ color:'#bae6fd' }}>[{l.tag}] TX</span>
                      <code style={{ color:'#93c5fd' }}>{l.tx}</code>
                    </div>
                    <div style={{ display:'flex', gap:8, alignItems:'baseline' }}>
                      <span style={{ width:44 }} />
                      <span style={{ color:'#bbf7d0' }}>[{l.tag}] RX</span>
                      <code style={{ color:'#a7f3d0' }}>{l.rx}</code>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </header>
      <main>
        <Unified />
      </main>
      {msg && <div style={{ position: 'fixed', right: 12, bottom: 8, color: '#7a8899', fontSize: 12 }}>preload: {msg}</div>}
    </div>
  )
}
