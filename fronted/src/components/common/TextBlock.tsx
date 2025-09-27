import React, { useEffect, useRef } from 'react'

type Props = {
  value?: string
  className?: string
  style?: React.CSSProperties
  mono?: boolean
  minHeight?: number | string
  maxHeight?: number | string
  autoScroll?: boolean
  wrap?: 'wrap' | 'nowrap'
  ariaLabel?: string
  onClick?: React.MouseEventHandler<HTMLDivElement>
}

export default function TextBlock({
  value = '',
  className,
  style,
  mono = true,
  minHeight = 120,
  maxHeight,
  autoScroll = false,
  wrap = 'wrap',
  ariaLabel,
  onClick,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!autoScroll) return
    const el = ref.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [value, autoScroll])

  const baseStyle: React.CSSProperties = {
    width: '100%',
    minHeight,
    maxHeight,
    overflow: 'auto',
    fontFamily: mono ? 'monospace' : undefined,
    whiteSpace: wrap === 'nowrap' ? 'pre' : 'pre-wrap',
    wordBreak: wrap === 'nowrap' ? 'normal' : 'break-word',
    padding: 8,
    borderRadius: 4,
    // 留給主題樣式接手，這裡提供最低限度外框以便使用
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'transparent',
  }

  return (
    <div
      ref={ref}
      className={['text-block', className].filter(Boolean).join(' ')}
      style={{ ...baseStyle, ...style }}
      role="textbox"
      aria-readonly="true"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {value}
    </div>
  )
}
