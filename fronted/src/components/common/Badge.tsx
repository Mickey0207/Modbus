import React from 'react'

export default function Badge({ color='blue', children }: { color?: 'blue'|'green'|'red'; children: React.ReactNode }) {
  const cls = ['badge', color==='green'?'green':'', color==='red'?'red':''].filter(Boolean).join(' ')
  return <span className={cls}>{children}</span>
}
