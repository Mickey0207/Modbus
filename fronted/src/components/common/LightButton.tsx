import React, { useEffect, useState } from 'react'

type Props = {
  on?: boolean
  onChange?: (next: boolean) => void
  title?: string
  size?: 'sm' | 'md'
  children?: React.ReactNode
  disableToggle?: boolean
  className?: string
  onContextMenu?: (e: React.MouseEvent) => void
  onClick?: (e: React.MouseEvent) => void
  color?: 'default' | 'yellow' | 'red'
}

export default function LightButton({ on=false, onChange, title, size='sm', children, disableToggle=false, className, onContextMenu, onClick, color='default' }: Props) {
  const [val, setVal] = useState(on)
  useEffect(() => { setVal(on) }, [on])
  const toggled = (next: boolean) => { setVal(next); onChange?.(next) }
  const cls = ['light-btn', val ? 'on' : 'off', (val && color!=='default') ? color : '', size === 'md' ? 'md' : 'sm', className ?? ''].join(' ').trim()
  return (
    <button
      type="button"
      className={cls}
      aria-pressed={val}
      title={title}
      onClick={(e) => { onClick?.(e); if (!disableToggle) toggled(!val) }}
      onContextMenu={onContextMenu}
    >{children}</button>
  )
}
