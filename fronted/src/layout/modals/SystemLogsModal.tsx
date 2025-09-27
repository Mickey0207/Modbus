import React, { useMemo, useState } from 'react'
import { Modal, SmartTable, Select, Button } from '@/components'
import { useMessages } from '@/api/contexts/MessagesContext'

export default function SystemLogsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { messages, clear, push } = useMessages()
  const [level, setLevel] = useState<'all'|'info'|'success'|'warning'|'error'>('all')

  const data = useMemo(() => messages.filter(m => level === 'all' ? true : m.level === level), [messages, level])

  const columns = [
    { key: 'ts', title: '時間', width: 160, render: (v: number) => new Date(v).toLocaleString() },
    { key: 'level', title: '層級', width: 90 },
    { key: 'text', title: '內容' },
  ]

  

  return (
    <Modal isOpen={open} onClose={onClose} title="系統訊息">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <Select
            value={level}
            onChange={(v: string)=>setLevel(v as any)}
            options={[
              { value: 'all', label: '全部' },
              { value: 'info', label: '資訊' },
              { value: 'success', label: '成功' },
              { value: 'warning', label: '警告' },
              { value: 'error', label: '錯誤' },
            ]}
          />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button className="btn--outline" onClick={clear} disabled={!messages.length}>清除</Button>
        </div>
      </div>
      <div className="card" style={{ overflow: 'auto', maxHeight: '62vh' }}>
        <SmartTable columns={columns as any} data={data as any} rowKey={(r:any)=>r.id} />
      </div>
    </Modal>
  )
}
