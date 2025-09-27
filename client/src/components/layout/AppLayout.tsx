import React, { useEffect, useMemo, useState } from 'react'
import { Layout, Menu, Breadcrumb, theme } from 'antd'
import type { MenuProps } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { modules } from '../../modules'
import { useMessages } from '../../api/contexts/MessagesContext'
// no direct modal logic here; use extracted modal components
import ReadHoldingRegistersModal from './modals/ReadHoldingRegistersModal'
import WriteSingleRegisterModal from './modals/WriteSingleRegisterModal'
import SystemLogsModal from './modals/SystemLogsModal'
import { useHosts } from '../hosts/useHosts'

const { Header, Content, Sider } = Layout

function buildMenuItems(navigate: (path: string) => void): MenuProps['items'] {
  return modules.map(m => {
    const hasChildren = (m.children || []).length > 0
    const parent: any = {
      key: m.path,
      icon: m.icon,
      // 讓父節點標題可點擊導頁
      label: (
        <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(m.path) }} className="cursor-pointer">
          {m.title}
        </span>
      ),
      // 同時提供 onTitleClick 以支援點擊 SubMenu 標題導頁
      onTitleClick: () => navigate(m.path),
    }
    if (hasChildren) {
      parent.children = (m.children || []).map(ch => ({ key: ch.path, icon: ch.icon, label: ch.title }))
    }
    return parent
  })
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken()

  const items = useMemo(() => buildMenuItems((p) => navigate(p)), [navigate])

  // compute selected/open keys
  const selectedKey = location.pathname
  const derivedOpenKeys = useMemo(() => {
    const parent = modules.find(m => selectedKey.startsWith(m.path) && (m.path !== '/'))
    return parent ? [parent.path] : []
  }, [selectedKey])
  const [menuOpenKeys, setMenuOpenKeys] = useState<string[]>(derivedOpenKeys)
  useEffect(() => { setMenuOpenKeys(derivedOpenKeys) }, [derivedOpenKeys])

  // breadcrumb
  const breadcrumbItems = useMemo(() => {
    const parent = modules.find(m => selectedKey === m.path || selectedKey.startsWith(m.path + '/'))
    const child = parent?.children?.find(ch => ch.path === selectedKey)
    const arr: { title: React.ReactNode }[] = []
    // 首頁：導回根路徑（你的路由會把 / 導到 /status）
    arr.push({ title: <a onClick={() => navigate('/')} className="link">首頁</a> })
    if (parent) arr.push({ title: <a onClick={() => navigate(parent.path)} className="link">{parent.title}</a> })
    if (child) arr.push({ title: child.title })
    return arr
  }, [selectedKey, navigate])

  // Navbar functionality (hosts status, actions, logs)
  const { messages, push } = useMessages()
  const latest = messages[0]
  const { hosts, refresh } = useHosts({ pollMs: 2000 })
  const connectedCount = useMemo(() => hosts.filter(h => h.connected).length, [hosts])
  useEffect(() => { refresh() }, [refresh])

  const [openRead, setOpenRead] = useState(false)
  const [openWrite, setOpenWrite] = useState(false)
  const [openLogs, setOpenLogs] = useState(false)

  return (
    <Layout className="min-h-screen">
      <Header className="header-gradient row justify-between gap-20">
        <div className="row gap-20">
          <div className="brand-title">Modbus Tool</div>
          <div className="header-stat">主機：{connectedCount}/{hosts.length} 已連線</div>
          <div className="row gap-10">
            <button className="navbar-btn primary" onClick={() => setOpenRead(true)}>讀取</button>
            <button className="navbar-btn" onClick={() => setOpenWrite(true)}>寫入</button>
          </div>
        </div>
        {/* 系統資訊區塊（恢復舊版結構與樣式，避免內聯樣式干擾尺寸） */}
        <div className="navbar-right">
          <div
            className="system-messages cursor-pointer"
            onClick={() => setOpenLogs(true)}
            title={latest ? `${new Date(latest.ts).toLocaleString()} [${latest.level}] ${latest.text}` : undefined}
          >
            <div className={`message-display message-${latest?.level ?? 'info'}`}>
              <span className="latest-message truncate">
                {latest ? `${new Date(latest.ts).toLocaleTimeString()} [${latest.level}] ${latest.text}` : '—'}
              </span>
            </div>
          </div>
        </div>
      </Header>
      <Layout>
        <Sider width={220} style={{ background: colorBgContainer }}>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            openKeys={menuOpenKeys}
            style={{ height: '100%', borderInlineEnd: 0 }}
            items={items}
            onClick={({ key }) => navigate(String(key))}
            onOpenChange={(keys) => setMenuOpenKeys(keys as string[])}
          />
        </Sider>
        <Layout style={{ padding: '12px 24px 24px' }}>
          <Breadcrumb items={breadcrumbItems} style={{ margin: '12px 0' }} />
          <Content style={{ padding: 24, margin: 0, background: colorBgContainer, borderRadius: borderRadiusLG }}>
            {children}
          </Content>
        </Layout>
      </Layout>

      {/* Read Modal */}
      <ReadHoldingRegistersModal open={openRead} onClose={() => setOpenRead(false)} hosts={hosts} push={push} />
      {/* Write Modal */}
      <WriteSingleRegisterModal open={openWrite} onClose={() => setOpenWrite(false)} hosts={hosts} push={push} />
      {/* Logs Modal */}
      <SystemLogsModal open={openLogs} onClose={() => setOpenLogs(false)} />
    </Layout>
  )
}
// extracted modal components are in ../modals
