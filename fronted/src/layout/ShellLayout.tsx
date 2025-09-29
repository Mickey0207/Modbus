import React, { useEffect, useMemo, useState } from 'react'
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
import * as SitesApi from '@/api/sites/service'
import { flush } from '@/api/modbus/queue'
import { writeSingleRegister } from '@/api/modbus/operations'

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()
  const mod = pathname.split('/')[1] || 'read'

  const [readOpen, setReadOpen] = useState(false)
  const [writeOpen, setWriteOpen] = useState(false)
  const [openWeb, setOpenWeb] = useState(false)
  const [openPoll, setOpenPoll] = useState(false)
  const [openDb, setOpenDb] = useState(false)
  const [openDbMb, setOpenDbMb] = useState(false)
  const [openDbDb, setOpenDbDb] = useState(false)
  const [openSend, setOpenSend] = useState(false)
  const [readSlaveOpen, setReadSlaveOpen] = useState(false)
  const [writeSlaveOpen, setWriteSlaveOpen] = useState(false)
  const { hosts } = useHosts({ pollMs: 2000 })
  const { push, last } = useMessages()
  // 將舊版 (level,text) 介面包成新頻道 API
  const pushSend = (lvl: 'info'|'success'|'warning'|'error', text: string) => push({ channel: 'modbusSend', level: lvl, text })

  // 跑馬燈動畫控制
  // 每個頻道分別觸發 bump 動畫
  const [bumpWeb, setBumpWeb] = useState(false)
  const [bumpPoll, setBumpPoll] = useState(false)
  const [bumpSend, setBumpSend] = useState(false)
  const [bumpDb, setBumpDb] = useState(false)
  const [bumpDbMb, setBumpDbMb] = useState(false)
  const [bumpDbDb, setBumpDbDb] = useState(false)
  useEffect(()=>{ if (!last.web?.id) return; setBumpWeb(true); const t=setTimeout(()=>setBumpWeb(false),420); return ()=>clearTimeout(t) }, [last.web?.id])
  useEffect(()=>{ if (!last.modbusPoll?.id) return; setBumpPoll(true); const t=setTimeout(()=>setBumpPoll(false),420); return ()=>clearTimeout(t) }, [last.modbusPoll?.id])
  useEffect(()=>{ if (!last.dbPollMb?.id) return; setBumpDbMb(true); const t=setTimeout(()=>setBumpDbMb(false),420); return ()=>clearTimeout(t) }, [last.dbPollMb?.id])
  useEffect(()=>{ if (!last.dbPollDb?.id) return; setBumpDbDb(true); const t=setTimeout(()=>setBumpDbDb(false),420); return ()=>clearTimeout(t) }, [last.dbPollDb?.id])
  useEffect(()=>{ if (!last.modbusSend?.id) return; setBumpSend(true); const t=setTimeout(()=>setBumpSend(false),420); return ()=>clearTimeout(t) }, [last.modbusSend?.id])
  // 移除模擬資料注入，改由實際 API 事件推送訊息
  const connectedCount = useMemo(() => hosts.filter(h => h.connected).length, [hosts])
  const [siteItems, setSiteItems] = useState<{to:string;label:string;end?:boolean;icon?:React.ReactNode}[]>([])

  useEffect(()=>{
    const rebuild = async () => {
      try {
        const sites = await SitesApi.listSites()
        const items = [{ to: '/sites/new', label: '新增案場', end: true } as any]
        for (const s of sites) items.push({ to: `/sites/${s.id}`, label: s.name, end: true } as any)
        setSiteItems(items)
      } catch {}
    }
    rebuild()
    const openReadM = () => setReadOpen(true)
    const openWriteM = () => setWriteOpen(true)
    const openReadS = () => setReadSlaveOpen(true)
    const openWriteS = () => setWriteSlaveOpen(true)
    window.addEventListener('open-read-master', openReadM)
    window.addEventListener('open-write-master', openWriteM)
    window.addEventListener('open-read-slave', openReadS)
    window.addEventListener('open-write-slave', openWriteS)
    return () => {
  // no-op
      window.removeEventListener('open-read-master', openReadM)
      window.removeEventListener('open-write-master', openWriteM)
      window.removeEventListener('open-read-slave', openReadS)
      window.removeEventListener('open-write-slave', openWriteS)
    }
  }, [pathname])

  // Flush queued modbus writes once a host becomes connected
  useEffect(()=>{
    const connectedMap = new Map(hosts.map(h => [h.id, !!h.connected]))
    flush((id)=>!!connectedMap.get(id), async (id, addr, val)=>{
      try {
        // 先投遞「送出」到 Modbus輪詢（不含結果）
        try { push({ channel: 'modbusPoll', level: 'info', text: `佇列寫出：${id} @${addr} = ${val}`, hostId: id, action: 'write', ok: undefined, target: 'host', modbus: { fc: 0x06, address: addr, values: [val] } }) } catch {}
        const r = await writeSingleRegister(id, addr, val)
        const ok = !!r?.success
        // 再投遞「結果」到 資料庫輪詢(Modbus)
        try { push({ channel: 'dbPollMb', level: ok ? 'success' : 'warning', text: `佇列寫出：${id} @${addr} = ${val}`, hostId: id, action: 'write', ok, target: 'host', modbus: { fc: 0x06, address: addr, values: [val] } }) } catch {}
        return ok
      } catch {
        // 失敗：送出已在前一段投遞，這裡只投遞結果到 資料庫輪詢(Modbus)
  try { push({ channel: 'dbPollMb', level: 'error', text: `佇列寫出：${id} @${addr} = ${val}`, hostId: id, action: 'write', ok: false, target: 'host', modbus: { fc: 0x06, address: addr, values: [val] } }) } catch {}
        return false
      }
    })
  }, [hosts])

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
            title="案場管理(開關/亮度)"
            icon={<IconGrid />}
            items={siteItems}
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
        <header className="topbar two-rows">
          {/* 第一行：系統資訊 */}
          <div className="topbar-row topbar-info" style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div className="topbar-pill ticker pill--web" role="button" onClick={()=>setOpenWeb(true)} title="系統資訊(網頁輪詢)">
              <span style={{ opacity:.75 }}>網頁輪詢</span>
              <span className={"mono ticker-text" + (bumpWeb ? ' ticker-bump' : '')} style={{ whiteSpace:'nowrap', display:'inline-block' }}>
                {last.web?.text || '—'}
              </span>
            </div>
            <div className="topbar-pill ticker pill--poll" role="button" onClick={()=>setOpenPoll(true)} title="系統資訊(Modbus輪詢)">
              <span style={{ opacity:.75 }}>Modbus輪詢</span>
              <span className={"mono ticker-text" + (bumpPoll ? ' ticker-bump' : '')} style={{ whiteSpace:'nowrap', display:'inline-block' }}>
                {last.modbusPoll?.text || '—'}
              </span>
            </div>
            <div className="topbar-pill ticker pill--db" role="button" onClick={()=>setOpenDbMb(true)} title="系統資訊(資料庫輪詢 Modbus)">
              <span style={{ opacity:.75 }}>資料庫輪詢(Modbus)</span>
              <span className={"mono ticker-text" + (bumpDbMb ? ' ticker-bump' : '')} style={{ whiteSpace:'nowrap', display:'inline-block' }}>
                {last.dbPollMb?.text || '—'}
              </span>
            </div>
            <div className="topbar-pill ticker pill--db" role="button" onClick={()=>setOpenDbDb(true)} title="系統資訊(資料庫輪詢 DB)">
              <span style={{ opacity:.75 }}>資料庫輪詢(DB)</span>
              <span className={"mono ticker-text" + (bumpDbDb ? ' ticker-bump' : '')} style={{ whiteSpace:'nowrap', display:'inline-block' }}>
                {last.dbPollDb?.text || '—'}
              </span>
            </div>
            <div className={"topbar-pill ticker " + ((last.modbusSend?.ok === false || last.modbusSend?.level === 'error') ? 'pill--send-error' : 'pill--send-success')} role="button" onClick={()=>setOpenSend(true)} title="系統資訊(Modbus傳送)">
              <span style={{ opacity:.75 }}>Modbus傳送</span>
              <span className={"mono ticker-text" + (bumpSend ? ' ticker-bump' : '')} style={{ whiteSpace:'nowrap', display:'inline-block' }}>
                {last.modbusSend?.text || '—'}
              </span>
            </div>
          </div>
          {/* 第二行：品牌 / 狀態 / 操作 */}
          <div className="topbar-row topbar-nav" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
            <div className="topbar-left" style={{ display:'flex', alignItems:'center', gap:14 }}>
              <div className="topbar-brand">Modbus TCP & 485</div>
              <div className="topbar-status">主機：{connectedCount} / {hosts.length} 已連線</div>
            </div>
            <div className="topbar-actions btn-group">
              <Button className="btn--sm btn--outline" onClick={()=>setReadOpen(true)}>讀取 Master</Button>
              <Button className="btn--sm btn--outline" onClick={()=>setWriteOpen(true)}>寫入 Master</Button>
              <Button className="btn--sm btn--outline" onClick={()=>setReadSlaveOpen(true)}>讀取 Slave</Button>
              <Button className="btn--sm btn--outline" onClick={()=>setWriteSlaveOpen(true)}>寫入 Slave</Button>
            </div>
          </div>
        </header>
        <section className="app-content">
          {children}
        </section>
        {/* Popout modals */}
  <ReadHoldingRegistersModal open={readOpen} onClose={()=>setReadOpen(false)} hosts={hosts} push={pushSend} />
  <WriteSingleRegisterModal open={writeOpen} onClose={()=>setWriteOpen(false)} hosts={hosts} push={pushSend} />
  <ReadHoldingRegistersSlaveModal open={readSlaveOpen} onClose={()=>setReadSlaveOpen(false)} hosts={hosts} push={pushSend} />
  <WriteSingleRegisterSlaveModal open={writeSlaveOpen} onClose={()=>setWriteSlaveOpen(false)} hosts={hosts} push={pushSend} />
  <SystemLogsModal open={openWeb} onClose={()=>setOpenWeb(false)} channel="web" title="系統資訊（網頁輪詢）" />
  <SystemLogsModal open={openPoll} onClose={()=>setOpenPoll(false)} channel="modbusPoll" title="系統資訊（Modbus輪詢）" />
  <SystemLogsModal open={openDbMb} onClose={()=>setOpenDbMb(false)} channel="dbPollMb" title="系統資訊（資料庫輪詢 Modbus）" />
  <SystemLogsModal open={openDbDb} onClose={()=>setOpenDbDb(false)} channel="dbPollDb" title="系統資訊（資料庫輪詢 DB）" />
  <SystemLogsModal open={openSend} onClose={()=>setOpenSend(false)} channel="modbusSend" title="系統資訊（Modbus傳送）" />
      </main>
    </div>
  )
}
