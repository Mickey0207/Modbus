import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type SelectOption = { label: string; value: string }

type Props = {
  value?: string
  onChange?: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
  searchable?: boolean
  maxMenuHeight?: number
  filterPlaceholder?: string
}

export default function Select({ value, onChange, options, placeholder='請選擇', disabled, className, size='md', searchable, maxMenuHeight=280, filterPlaceholder='搜尋…' }: Props) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState<number>(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [portalPos, setPortalPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)
  const hasWide = useMemo(() => (className ?? '').split(/\s+/).includes('wide'), [className])
  const menuRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')

  const current = useMemo(() => options.find(o => o.value === value), [options, value])
  const enableSearch = (typeof searchable === 'boolean' ? searchable : options.length > 10)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
  }, [options, query])

  const toggle = () => { if (!disabled) setOpen(o => !o) }
  const close = () => setOpen(false)
  const commit = (idx: number) => {
    const opt = filtered[idx]
    if (!opt) return
    onChange?.(opt.value)
    close()
    btnRef.current?.focus()
  }

  // 點擊外部關閉
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current
      const t = e.target as HTMLElement | null
      // 如果點擊在 Portal 渲染的下拉清單內，就不關閉
      if (t && t.closest('.select-list')) return
      if (el && !el.contains(t as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    const recalc = () => {
      const btn = btnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const vw = window.innerWidth
      const gap = 6
      // 舊版行為：永遠往下展開，不限制高度
      const top = r.bottom + gap
      const minWidth = hasWide ? Math.max(520, r.width) : r.width
      const left = Math.min(vw - minWidth - 8, Math.max(8, r.left))
      setPortalPos({ top, left, minWidth })
    }
    recalc()
    window.addEventListener('scroll', recalc, true)
    window.addEventListener('resize', recalc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', recalc, true)
      window.removeEventListener('resize', recalc)
    }
  }, [open, hasWide])

  // 開啟後測量真實寬度，避免選項換行，並將左側位置限制在視窗內
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu || !portalPos) return
    // 讓內容決定寬度，但至少不小於按鈕寬度
    const vw = window.innerWidth
    const rect = menu.getBoundingClientRect()
    const nextLeft = Math.min(portalPos.left, Math.max(8, vw - rect.width - 8))
    if (nextLeft !== portalPos.left) setPortalPos(prev => prev ? { ...prev, left: nextLeft } : prev)
  }, [open, portalPos?.minWidth])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); setQuery(''); setHighlight(Math.max(0, filtered.findIndex(o => o.value === value))) }
      if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setQuery(''); setHighlight(0) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setQuery(''); setHighlight(filtered.length - 1) }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit(highlight >= 0 ? highlight : 0); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(filtered.length - 1, (h < 0 ? 0 : h + 1))) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, (h < 0 ? 0 : h - 1))) }
  }

  return (
    <div ref={wrapRef} className={["select", open ? 'open' : '', disabled ? 'disabled' : '', className ?? '', size].join(' ').trim()}>
      <button
        ref={btnRef}
        type="button"
        className="select-trigger"
        onClick={toggle}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={current?.label}
      >
    <span className={"select-value" + (!current ? ' placeholder' : '')}>{current?.label ?? placeholder}</span>
    <span className="select-caret" aria-hidden>▾</span>
      </button>
      {open && portalPos && createPortal(
        <div
          className={`select-list select-list--portal${hasWide ? ' wide' : ''}`}
          ref={menuRef}
          style={{ position: 'fixed', top: portalPos.top, left: portalPos.left, width: 'max-content', minWidth: portalPos.minWidth }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {enableSearch && (
            <div className="select-search">
              <input
                type="text"
                value={query}
                onChange={(e)=>{ setQuery(e.currentTarget.value); setHighlight(0) }}
                placeholder={filterPlaceholder}
                onKeyDown={(e)=>{ e.stopPropagation() }}
                autoFocus
              />
            </div>
          )}
          {/* 可滾輪捲動但不顯示卷軸：限制高度 + overflow，自動隱藏卷軸由 CSS 控制 */}
          <div role="listbox" className="select-scroll" style={{ maxHeight: maxMenuHeight, overflowY: 'auto' }}>
            {filtered.map((opt, i) => {
              const active = opt.value === value
              const hl = i === highlight
              return (
                <div
                  role="option"
                  aria-selected={active}
                  key={opt.value}
                  className={["select-option", active ? 'active' : '', hl ? 'highlight' : ''].join(' ').trim()}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => { e.preventDefault(); commit(i) }}
                >
                  <span className="dot" />
                  <span className="label">{opt.label}</span>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="select-empty">無符合項目</div>
            )}
          </div>
        </div>, document.body
      )}
    </div>
  )
}
