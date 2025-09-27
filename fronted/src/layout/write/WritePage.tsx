import React from 'react'
import { Button, Input } from '@/components/index'

export default function WritePage() {
  return (
    <div className="col">
      <div className="card">
        <h3 className="m-0">寫入單一暫存器</h3>
        <p className="text-muted">在此輸入位址與數值（彈出小頁面內容）。</p>
        <div className="row">
          <Input placeholder="位址" uiSize="sm" />
          <Input placeholder="數值" uiSize="sm" />
          <Button className="btn--sm">寫入</Button>
        </div>
      </div>
    </div>
  )
}
