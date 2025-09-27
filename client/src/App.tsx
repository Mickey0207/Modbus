import { useEffect, useMemo, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { MessagesProvider } from './api/contexts/MessagesContext'
import { modules } from './modules'
import { App as AntdApp } from 'antd'
import AppLayout from './components/layout/AppLayout'
import type { ModuleKey } from './modules/types'

function App() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [page, setPage] = useState<ModuleKey>('status')
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const location = useLocation()

  // Keep 'page' in sync with URL path
  useEffect(() => {
    const m = modules.find(m => m.path === location.pathname)
    if (m && m.key !== page) setPage(m.key)
  }, [location.pathname])

  const PageTitle = useMemo(() => {
    switch (page) {
      case 'status': return 'Modbus TCP/IP 目前主機連線狀態'
      case 'modbus': return 'Modbus 測試'
      default: return ''
    }
  }, [page])

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
      <AntdApp>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Navigate to="/status" replace />} />
            {modules.map(m => (
              <Route key={m.key} path={m.path} element={<m.View />} />
            ))}
            {modules.flatMap(m => (m.children || []).map(ch => (
              <Route key={`${m.key}-${ch.key}`} path={ch.path} element={ch.View ? <ch.View /> : <m.View />} />
            )))}
            <Route path="*" element={<Navigate to="/status" replace />} />
          </Routes>
        </AppLayout>
      </AntdApp>
    </MessagesProvider>
  )
}

export default App
