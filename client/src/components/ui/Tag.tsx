import React from 'react'

export type TagVariant = 'info' | 'success' | 'warning' | 'error' | 'neutral'

export default function Tag({ variant = 'neutral', children, className = '', style }: { variant?: TagVariant; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const map: Record<TagVariant, string> = {
    neutral: 'badge',
    info: 'badge badge--info',
    success: 'badge badge--success',
    warning: 'badge badge--warn',
    error: 'badge badge--err',
  }
  return <span className={`${map[variant]} ${className}`} style={style}>{children}</span>
}
