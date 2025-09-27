import React, { useEffect, useRef, useState } from 'react'
import NumberInput from './NumberInput'

type Props = {
  value: string | number
  onCommit: (value: string | number) => void
  type?: 'text' | 'number'
  placeholder?: string
  className?: string
}

export default function InlineEditableCell({ value, onCommit, type='text', placeholder='', className }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(String(value ?? ''))
  const [numDraft, setNumDraft] = useState<number>(Number(value ?? 0))
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (editing) {
      // 進入編輯即自動聚焦並全選，數字欄也一併處理
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          try { inputRef.current.select() } catch {}
        }
      }, 0)
    }
  }, [editing])
  useEffect(() => {
    if (!editing) {
      setDraft(String(value ?? ''))
      setNumDraft(Number(value ?? 0))
    }
  }, [value, editing])

  // 左鍵點擊編輯框外，自動提交
  useEffect(() => {
    if (!editing) return
    const handler = (e: MouseEvent) => {
      if (e.button !== 0) return // 僅左鍵
      const el = containerRef.current
      if (el && !el.contains(e.target as Node)) {
        commit()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [editing])

  const openEdit = (e: React.MouseEvent) => { e.preventDefault(); setDraft(String(value ?? '')); setNumDraft(Number(value ?? 0)); setEditing(true) }
  const cancel = () => { setEditing(false); setDraft(String(value ?? '')); setNumDraft(Number(value ?? 0)) }
  const commit = () => {
    setEditing(false)
    let next: string | number
    if (type === 'number') {
      // 優先從 DOM 讀值，避免 setState 非同步
      if (inputRef.current) {
        const raw = inputRef.current.value
        if (raw === '' || raw === '-' || raw === '+') {
          next = Number(value ?? 0)
        } else {
          const n = Number(raw)
          next = Number.isNaN(n) ? Number(value ?? 0) : n
        }
      } else {
        next = Number.isNaN(numDraft) ? Number(value ?? 0) : numDraft
      }
    } else {
      // 文字欄位同樣優先從 DOM 讀值
      next = inputRef.current ? inputRef.current.value : draft
    }
    onCommit(next)
  }

  if (!editing) {
    return (
      <span className={className} onContextMenu={openEdit} title="右鍵編輯">
        {String(value ?? placeholder)}
      </span>
    )
  }

  if (type === 'number') {
    return (
      <span ref={containerRef}>
        <NumberInput
          ref={inputRef}
          value={numDraft}
          onChange={setNumDraft}
          size="sm"
          className={className}
          allowEmpty
          onBlur={commit}
          onKeyDown={(e)=>{ if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
        />
      </span>
    )
  }

  return (
    <span ref={containerRef}>
      <input
        ref={inputRef}
        type={type}
        className={["input", "input--sm", className ?? ''].join(' ').trim()}
        value={draft}
        onChange={(e)=>setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e)=>{ if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
      />
    </span>
  )
}
