import React, { useEffect, useMemo, useRef, useState } from 'react'

export type SelectOption = { label: string; value: string }

type Props = {
  value?: string
  onChange?: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
}

export default function Select({ value, onChange, options, placeholder='請選擇', disabled, className, size='md' }: Props) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState<number>(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const current = useMemo(() => options.find(o => o.value === value), [options, value])

  const toggle = () => { if (!disabled) setOpen(o => !o) }
  const close = () => setOpen(false)
  const commit = (idx: number) => {
    const opt = options[idx]
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
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); setHighlight(Math.max(0, options.findIndex(o => o.value === value))) }
      if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(0) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setHighlight(options.length - 1) }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit(highlight >= 0 ? highlight : 0); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(options.length - 1, (h < 0 ? 0 : h + 1))) }
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
      {open && (
        <div role="listbox" className="select-list">
          {options.map((opt, i) => {
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
        </div>
      )}
    </div>
  )
}
