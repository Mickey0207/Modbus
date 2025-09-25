import React, { ReactNode, useEffect, useRef, useState } from 'react'

export type Option = { value: string; label: ReactNode; disabled?: boolean }

export default function Select({ value, onChange, options, placeholder = '— 請選擇 —', disabled, className }: {
  value?: string,
  onChange: (val: string) => void,
  options: Option[],
  placeholder?: string,
  disabled?: boolean,
  className?: string,
}) {
  const [open, setOpen] = useState(false)
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
          {options.map(opt => (
            <div
              key={opt.value}
              className={`select-option ${opt.disabled ? 'is-disabled' : ''} ${opt.value === value ? 'is-selected' : ''}`}
              onClick={() => { if (!opt.disabled) { onChange(opt.value); setOpen(false) } }}
            >
              {opt.label}
            </div>
          ))}
          {options.length === 0 && (
            <div className="select-empty">無選項</div>
          )}
        </div>
      )}
    </div>
  )
}
