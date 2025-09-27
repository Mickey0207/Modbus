import React, { useState } from 'react'
import { useLocation } from 'react-router-dom'
import SiderGroup from './SiderGroup'
import { IconGauge, IconGrid, IconLink, IconUsb } from '@/components/icons'
import { Modal, Button, Badge } from '@/components/index'
import ReadPanel from '@/layout/read/ReadPage'
import WritePanel from '@/layout/write/WritePage'
import SystemPanel from '@/layout/system/SystemPage'

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()
  const mod = pathname.split('/')[1] || 'read'

  const [readOpen, setReadOpen] = useState(false)
  const [writeOpen, setWriteOpen] = useState(false)
  const [sysOpen, setSysOpen] = useState(false)

  return (
    <div className="app-shell">
      <aside className={"app-sider" + (collapsed ? " collapsed" : "")}> 
        <div className="brand">Modbus TCP & 485</div>
        <nav>
          <SiderGroup
            title="Master/Slave"
            icon={<IconGauge />}
            items={[{ to: '/status', label: '狀態/寸動', end: true, icon: <IconGauge /> }]}
          />
          <SiderGroup
            title="Modbus 測試"
            icon={<IconGrid />}
            items={[
              { to: '/modbus/port-scan', label: 'TCP/IP 埠掃描', end: true, icon: <IconLink /> },
              { to: '/modbus/transparent-forward', label: 'TCP/IP 透明轉發', end: true, icon: <IconUsb /> },
            ]}
          />
        </nav>
        <button className="sider-toggle" aria-label="切換側邊欄" onClick={()=>setCollapsed(v=>!v)}>{collapsed?'>':'<'}</button>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-brand">Modbus TCP & 485</div>
            <div className="topbar-status">主機：0 / 0 已連線</div>
            <div className="btn-group">
              <Button className="btn--sm btn--success" onClick={()=>setReadOpen(true)}>讀取</Button>
              <Button className="btn--sm btn--outline" onClick={()=>setWriteOpen(true)}>寫入</Button>
            </div>
          </div>
          <div className="topbar-right">
            <div className="topbar-pill" role="button" onClick={()=>setSysOpen(true)} title="系統資訊 / 訊息">
              —
            </div>
          </div>
        </header>
        <section className="app-content">
          {children}
        </section>
        {/* Popout modals */}
        <Modal isOpen={readOpen} onClose={()=>setReadOpen(false)} title="讀取">
          <ReadPanel />
        </Modal>
        <Modal isOpen={writeOpen} onClose={()=>setWriteOpen(false)} title="寫入">
          <WritePanel />
        </Modal>
        <Modal isOpen={sysOpen} onClose={()=>setSysOpen(false)} title="系統資訊">
          <SystemPanel />
        </Modal>
      </main>
    </div>
  )
}
