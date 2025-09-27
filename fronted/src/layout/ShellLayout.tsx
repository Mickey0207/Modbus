import React, { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import SiderGroup from './SiderGroup'
import { IconGauge, IconGrid, IconLink, IconUsb } from '@/components/icons'
import { Button } from '@/components/index'
import useHosts from '@/hooks/useHosts'
import { useMessages } from '@/api/contexts/MessagesContext'
import ReadHoldingRegistersModal from '@/layout/modals/ReadHoldingRegistersModal'
import WriteSingleRegisterModal from '@/layout/modals/WriteSingleRegisterModal'
import ReadHoldingRegistersSlaveModal from '@/layout/modals/ReadHoldingRegistersSlaveModal'
import WriteSingleRegisterSlaveModal from '@/layout/modals/WriteSingleRegisterSlaveModal'
import SystemLogsModal from '@/layout/modals/SystemLogsModal'

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()
  const mod = pathname.split('/')[1] || 'read'

  const [readOpen, setReadOpen] = useState(false)
  const [writeOpen, setWriteOpen] = useState(false)
  const [sysOpen, setSysOpen] = useState(false)
  const [readSlaveOpen, setReadSlaveOpen] = useState(false)
  const [writeSlaveOpen, setWriteSlaveOpen] = useState(false)
  const { hosts } = useHosts({ pollMs: 2000 })
  const { push } = useMessages()
  const connectedCount = useMemo(() => hosts.filter(h => h.connected).length, [hosts])

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
              { to: '/modbus/serial-spy', label: 'RS-485 監聽', end: true, icon: <IconUsb /> },
            ]}
          />
        </nav>
        <button className="sider-toggle" aria-label="切換側邊欄" onClick={()=>setCollapsed(v=>!v)}>{collapsed?'>':'<'}</button>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-brand">Modbus TCP & 485</div>
            <div className="topbar-status">主機：{connectedCount} / {hosts.length} 已連線</div>
            <div className="btn-group">
              <Button className="btn--sm btn--outline" onClick={()=>setReadOpen(true)}>讀取 Master</Button>
              <Button className="btn--sm btn--outline" onClick={()=>setWriteOpen(true)}>寫入 Master</Button>
              <Button className="btn--sm btn--outline" onClick={()=>setReadSlaveOpen(true)}>讀取 Slave</Button>
              <Button className="btn--sm btn--outline" onClick={()=>setWriteSlaveOpen(true)}>寫入 Slave</Button>
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
  <ReadHoldingRegistersModal open={readOpen} onClose={()=>setReadOpen(false)} hosts={hosts} push={push} />
  <WriteSingleRegisterModal open={writeOpen} onClose={()=>setWriteOpen(false)} hosts={hosts} push={push} />
  <ReadHoldingRegistersSlaveModal open={readSlaveOpen} onClose={()=>setReadSlaveOpen(false)} hosts={hosts} push={push} />
  <WriteSingleRegisterSlaveModal open={writeSlaveOpen} onClose={()=>setWriteSlaveOpen(false)} hosts={hosts} push={push} />
        <SystemLogsModal open={sysOpen} onClose={()=>setSysOpen(false)} />
      </main>
    </div>
  )
}
