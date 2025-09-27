import React, { useState } from 'react'
import { Modal as ModalFromComponents, Table, Tag, Select as SelectComponent } from '../..'
import { useMessages } from '../../../api/contexts/MessagesContext'

const GlassModal: any = ModalFromComponents as any

export default function SystemLogsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { messages } = useMessages()
  const [filter, setFilter] = useState<'all' | 'info' | 'success' | 'warning' | 'error'>('all')
  const items = (messages || []).slice(0, 100).filter(m => filter==='all' ? true : m.level===filter)
  const levelVariant = (lvl: string) => lvl==='success' ? 'success' : lvl==='error' ? 'error' : lvl==='warning' ? 'warning' : 'info'

  return (
    <GlassModal isOpen={open} title="系統資訊" onClose={onClose} size="max-w-3xl">
      <h3 className="m-0 text-gray-900">系統資訊（最多 100 筆）</h3>
      <div className="row justify-between mb-2">
        <div className="row items-center gap-2">
          <label className="text-sm text-gray-600">過濾：</label>
          <SelectComponent
            value={filter}
            onChange={((v: any) => setFilter(v)) as any}
            options={[
              { value: 'all', label: '全部' },
              { value: 'info', label: '資訊' },
              { value: 'success', label: '成功' },
              { value: 'warning', label: '警告' },
              { value: 'error', label: '錯誤' },
            ] as any}
          />
        </div>
      </div>
      <div className="card max-h-120 overflow-auto">
        {(() => {
          const columns = [
            { title: '時間', dataIndex: 'ts', key: 'ts', width: 140, render: (v: number) => new Date(v).toLocaleString() },
            { title: '等級', dataIndex: 'level', key: 'level', width: 100, render: (lvl: string) => <Tag variant={levelVariant(lvl) as any}>{lvl}</Tag> },
            { title: '內容', dataIndex: 'text', key: 'text', render: (t: string) => <span className="pre-wrap break-words">{t}</span> },
          ];
          return <Table columns={columns as any} dataSource={items as any} rowKey={(r: any) => r.id} />
        })()}
      </div>
    </GlassModal>
  )
}
