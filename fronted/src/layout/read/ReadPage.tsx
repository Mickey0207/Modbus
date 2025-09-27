import React from 'react'
import { Button, Input } from '@/components/index'

export default function ReadPage() {
  return (
    <div className="col">
      <div className="card">
        <h3 className="m-0">讀取保持暫存器</h3>
        <p className="text-muted">選擇參數並執行讀取（彈出小頁面內容）。</p>
        <div className="row">
          <Input placeholder="起始位址" uiSize="sm" />
          <Input placeholder="讀取長度" uiSize="sm" />
          <Button className="btn--sm">讀取</Button>
        </div>
      </div>
    </div>
  )
}
