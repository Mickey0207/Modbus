import { useMemo, useState } from 'react'

type NavKey = 'status' | 'logs'

export interface SidebarProps {
  current: NavKey
  onNavigate: (key: NavKey) => void
  onExpandChange?: (expanded: boolean) => void
}

export default function Sidebar({ current, onNavigate, onExpandChange }: SidebarProps) {
  const [expanded, setExpanded] = useState(false)
  const width = expanded ? 220 : 64

  const items = useMemo(() => ([
    {
      key: 'status' as NavKey,
      label: '主機狀態',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      )
    },
    {
      key: 'logs' as NavKey,
      label: '系統資訊',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v18H3z"/><path d="M7 7h10v10H7z"/></svg>
      )
    }
  ]), [])

  return (
    <aside
      onMouseEnter={() => { setExpanded(true); onExpandChange?.(true) }}
      onMouseLeave={() => { setExpanded(false); onExpandChange?.(false) }}
      style={{
        width,
        transition: 'width 160ms ease',
        alignSelf: 'stretch',
        height: 'auto',
        position: 'relative',
        background: 'rgba(248,249,251,0.9)',
        backdropFilter: 'saturate(140%) blur(6px)',
        WebkitBackdropFilter: 'saturate(140%) blur(6px)',
        borderRight: '1px solid rgba(0,0,0,0.06)',
        boxShadow: 'inset -1px 0 0 rgba(0,0,0,0.04)',
        display: 'flex', flexDirection: 'column',
        padding: '8px 8px 8px 0'
      }}
    >
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(it => {
          const active = current === it.key
          return (
            <button
              key={it.key}
              onClick={() => onNavigate(it.key)}
              className="btn btn--ghost"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', textAlign: 'left',
                padding: expanded ? '10px 12px' : '10px 8px',
                borderRadius: 8,
                background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                color: active ? '#4f46e5' : '#333',
                border: '1px solid transparent'
              }}
              title={it.label}
            >
              <span style={{ width: 24, display: 'inline-flex', justifyContent: 'center' }}>{it.icon}</span>
              {expanded && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
