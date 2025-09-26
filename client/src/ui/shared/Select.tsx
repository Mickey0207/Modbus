import React, { ReactNode, useEffect, useMemo, useRef, useState } from 'react'

export type Option = { value: string; label: ReactNode; disabled?: boolean; searchText?: string }

export default function Select({ value, onChange, options, placeholder = '— 請選擇 —', disabled, className, filterable = false, getLabelText }: {
  value?: string,
  onChange: (val: string) => void,
  options: Option[],
  placeholder?: string,
  disabled?: boolean,
  className?: string,
  filterable?: boolean,
  getLabelText?: (opt: Option) => string,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const current = options.find(o => o.value === value)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => { if (!open) setQuery('') }, [open])

  const filtered = useMemo(() => {
    if (!filterable || !query.trim()) return options
    const q = query.trim().toLowerCase()
    const toText = (opt: Option) => opt.searchText
      ?? (typeof opt.label === 'string' ? opt.label : '')
      ?? ''
    return options.filter(opt => {
      const base = (toText(opt) + ' ' + (getLabelText ? getLabelText(opt) : '') + ' ' + opt.value).toLowerCase()
      return base.includes(q)
    })
  }, [options, filterable, query, getLabelText])

  return (
    <div ref={rootRef} className={`select-control ${className || ''} ${disabled ? 'is-disabled' : ''}`} tabIndex={0} onKeyDown={e => {
      if (e.key === 'Escape') setOpen(false)
    }}>
      <button type="button" className="select-trigger" disabled={disabled} onClick={() => setOpen(v => !v)}>
        <div className="select-value">{current ? current.label : <span className="select-placeholder">{placeholder}</span>}</div>
        <span className="select-caret" aria-hidden>▾</span>
      </button>
      {open && !disabled && (
        <div className="select-menu">
          {filterable && (
            <div style={{ padding: 8, borderBottom: '1px solid #eee', background: '#fafafa', position: 'sticky', top: 0 }}>
              <input
                type="text"
                placeholder="搜尋選項…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', fontSize: 14 }}
              />
            </div>
          )}
          {filtered.map(opt => (
            <div
              key={opt.value}
              className={`select-option ${opt.disabled ? 'is-disabled' : ''} ${opt.value === value ? 'is-selected' : ''}`}
              onClick={() => { if (!opt.disabled) { onChange(opt.value); setOpen(false) } }}
            >
              {opt.label}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="select-empty">無符合的選項</div>
          )}
        </div>
      )}
    </div>
  )
}
