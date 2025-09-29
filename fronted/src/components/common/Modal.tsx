import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  isOpen: boolean
  onClose: () => void
  title?: string
  children?: React.ReactNode
  maxWidth?: number | string
  fitContent?: boolean
}

export default function Modal({ isOpen, onClose, title, children, maxWidth = 820, fitContent = false }: Props) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    // 鎖定背景滾動（避免長頁面時滾動到背景）
    const prevOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.documentElement.style.overflow = prevOverflow
    }
  }, [isOpen, onClose])

  if (!isOpen) return null
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth, width: fitContent ? 'max-content' as any : undefined }} onClick={e => e.stopPropagation()}>
        {title && <div className="modal-header"><h3 className="m-0">{title}</h3><button className="btn btn--ghost" onClick={onClose}>關閉</button></div>}
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
