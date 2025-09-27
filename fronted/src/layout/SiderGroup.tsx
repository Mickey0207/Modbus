import React, { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

export type SiderItem = { to: string; label: string; end?: boolean; icon?: React.ReactNode }

export default function SiderGroup({ title, items, icon }: { title: string; items: SiderItem[]; icon?: React.ReactNode }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    // 若目前路由屬於此群組，預設展開
    setOpen(items.some(it => pathname.startsWith(it.to.replace(/\/*$/, '/'))))
  }, [pathname])
  return (
    <div className="sider-group">
      <button className="sider-title row" onClick={() => setOpen(v=>!v)} aria-expanded={open}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        {icon && <span className="sider-ico">{icon}</span>}
        <span>{title}</span>
      </button>
      {open && (
        <div className="sider-items">
          {items.map(it => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({isActive})=>"sider-link"+(isActive?" active":"")}>
              {it.icon && <span className="sider-ico">{it.icon}</span>}
              <span>{it.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}
