import React, { useEffect } from 'react'

type Props = {
  isOpen: boolean
  onClose: () => void
  title?: string
  children?: React.ReactNode
  maxWidth?: number | string
}

export default function Modal({ isOpen, onClose, title, children, maxWidth = 820 }: Props) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth }} onClick={e => e.stopPropagation()}>
        {title && <div className="modal-header"><h3 className="m-0">{title}</h3><button className="btn btn--ghost" onClick={onClose}>關閉</button></div>}
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  )
}
