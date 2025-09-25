import { useEffect, useState } from 'react'
import HostsPanel from './features/hosts/HostsPanel'
import Navbar from './components/Navbar'
import { MessagesProvider } from './contexts/MessagesContext'

function App() {
  const [message, setMessage] = useState('載入中...')

  useEffect(() => {
    setMessage('歡迎使用 Modbus Tool (React)')
  }, [])

  return (
    <MessagesProvider>
      <Navbar />
      <div className="app-container">
        <header className="app-header">
          <h1>Modbus TCP 工具</h1>
          <p className="subtitle">React + SCSS 版本（開發中）</p>
        </header>
        <main className="app-main">
          <div className="card"><p>{message}</p></div>
          <HostsPanel />
        </main>
      </div>
    </MessagesProvider>
  )
}

export default App
