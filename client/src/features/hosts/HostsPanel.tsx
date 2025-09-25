import { useHosts } from './useHosts'

export default function HostsPanel() {
  const { hosts, loading, error, refresh } = useHosts()
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>多主機狀態</h3>
        <button className="btn" onClick={refresh} disabled={loading}>重新整理</button>
      </div>
      {error && <p style={{ color: '#ff8080' }}>{error}</p>}
      <ul style={{ paddingLeft: 16 }}>
        {hosts.map(h => (
          <li key={h.id}>
            <strong>{h.id}</strong> — {h.ip}:{h.port} (ID:{h.unitId})
            <span style={{ marginLeft: 8, color: h.connected ? '#3fb950' : '#ff7b72' }}>
              {h.connected ? '已連線' : '未連線'}
            </span>
          </li>
        ))}
        {hosts.length === 0 && !loading && <li>尚無主機</li>}
      </ul>
    </div>
  )
}
