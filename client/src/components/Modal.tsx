import { ReactNode } from 'react'

export default function Modal({ open, title, onClose, children, size = 'md' }: { open: boolean; title?: string; onClose: () => void; children: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  if (!open) return null
  const width = size === 'lg' ? 960 : size === 'sm' ? 400 : 520
  const maxWidth = size === 'lg' ? '96vw' : '90vw'
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div className="card" style={{ width, maxWidth, maxHeight: '90vh', overflow: 'auto', color: '#111' }} onClick={e => e.stopPropagation()}>
        {title && <h3 style={{ marginTop: 0 }}>{title}</h3>}
        {children}
      </div>
    </div>
  )
}
