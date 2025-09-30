import React, { useCallback, forwardRef, useEffect, useRef } from 'react'

type Props = {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
  size?: 'sm' | 'md'
  title?: string
  disabled?: boolean
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  allowEmpty?: boolean
}

const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  size = 'md',
  title,
  disabled,
  onBlur,
  onKeyDown,
  allowEmpty = false,
}, ref) {
  // 當滑鼠懸停或輸入框聚焦時，攔截全域滾輪避免頁面捲動（採用捕獲階段 + 非被動監聽）
  const hotRef = useRef(false)
  useEffect(() => {
    const onWheelCapture = (ev: WheelEvent) => {
      if (!hotRef.current) return
      // 僅阻止預設捲動，讓事件繼續傳到目標元素，由目標的 onWheel 處理數值變更
      try { ev.preventDefault() } catch {}
    }
    window.addEventListener('wheel', onWheelCapture, { capture: true, passive: false })
    return () => window.removeEventListener('wheel', onWheelCapture, { capture: true } as any)
  }, [])
  const clamp = useCallback((v: number) => {
    let n = v
    if (typeof min === 'number') n = Math.max(min, n)
    if (typeof max === 'number') n = Math.min(max, n)
    return n
  }, [min, max])

  const handleChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const raw = e.currentTarget.value
    if (allowEmpty && raw === '') { onChange(NaN); return }
    if (raw === '-' || raw === '+') return
    const n = Number(raw)
    if (!Number.isNaN(n)) onChange(clamp(n))
  }

  const handleWheel: React.WheelEventHandler<HTMLInputElement> = (e) => {
    if (disabled) return
    // 阻止頁面跟著滾動，僅調整數字本身
    e.preventDefault()
    e.stopPropagation()
    const delta = (e.deltaY ?? 0) > 0 ? -step : step
    onChange(clamp(value + delta))
  }

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (onKeyDown) onKeyDown(e)
    if (e.defaultPrevented || disabled) return
    if (e.key === 'ArrowUp') { e.preventDefault(); onChange(clamp(value + step)) }
    if (e.key === 'ArrowDown') { e.preventDefault(); onChange(clamp(value - step)) }
  }

  const displayedValue = (allowEmpty && Number.isNaN(value)) ? '' : value
  return (
    <input
      ref={ref}
      type="number"
      className={["num-input", size === 'sm' ? 'input--sm' : '', className ?? ''].join(' ').trim()}
      value={displayedValue as any}
      min={min}
      max={max}
      step={step}
      title={title}
      disabled={disabled}
      onChange={handleChange}
      onWheel={handleWheel}
      onMouseEnter={()=>{ hotRef.current = true }}
      onMouseLeave={()=>{ hotRef.current = false }}
      onFocus={()=>{ hotRef.current = true }}
  onBlur={(e)=>{ hotRef.current = false; onBlur?.(e) }}
      onKeyDown={handleKeyDown}
      inputMode="numeric"
    />
  )
})

export default NumberInput
