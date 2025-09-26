import { ReactNode, CSSProperties } from 'react'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'auto'

interface ModalProps {
  open: boolean
  title?: string
  onClose: () => void
  children: ReactNode
  size?: ModalSize
  maxWidth?: number | string
  maxHeight?: number | string
  fitContent?: boolean
  closeOnBackdrop?: boolean
  className?: string
  style?: CSSProperties
  footer?: ReactNode
}

export default function Modal({
  open,
  title,
  onClose,
  children,
  size = 'xl',
  maxWidth,
  maxHeight = '92vh',
  fitContent = false,
  closeOnBackdrop = true,
  className,
  style,
  footer
}: ModalProps) {
  if (!open) return null

  const widthMap: Record<Exclude<ModalSize, 'auto'>, number> = {
    sm: 480,
    md: 640,
    lg: 880,
    xl: 1120,
  }

  const targetPx = size === 'auto' ? 1280 : widthMap[size]
  const panelStyle: CSSProperties = {
    // 自適應：若 fitContent 或 auto，則以內容寬度為主，最多不超過 maxWidth / 96vw
    width: fitContent || size === 'auto' ? 'auto' : targetPx,
    maxWidth: typeof maxWidth !== 'undefined'
      ? maxWidth
      : `min(${size === 'auto' || fitContent ? targetPx : targetPx}px, 96vw)`,
    maxHeight,
    overflow: 'auto',
    color: '#111',
    background: 'rgba(255,255,255,0.88)',
    backdropFilter: 'saturate(160%) blur(4px)',
    WebkitBackdropFilter: 'saturate(160%) blur(4px)',
    border: '1px solid rgba(255,255,255,0.55)',
    borderRadius: 12,
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    padding: 16,
    ...style,
  }

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2,6,23,0.35)', // slate-950 with alpha
        backdropFilter: 'saturate(140%) blur(8px)',
        WebkitBackdropFilter: 'saturate(140%) blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={() => closeOnBackdrop && onClose()}
    >
      <div
        className={['card', className].filter(Boolean).join(' ')}
        style={panelStyle}
        onClick={e => e.stopPropagation()}
      >
        {(title || typeof onClose === 'function') && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            {title ? <h3 style={{ margin: 0 }}>{title}</h3> : <div />}
            <button
              onClick={onClose}
              aria-label="close"
              className="btn btn--sm btn--outline"
              style={{ lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        )}
        {children}
        {footer && (
          <div style={{ marginTop: 12 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
