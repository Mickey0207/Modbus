import React from 'react'
import { Button, Input } from '@/components/index'

export default function TcpIpTransparentForward() {
  return (
    <div className="col">
      <div className="card">
        <h3 className="m-0">TCP/IP 透明轉發</h3>
        <p className="text-muted">設定來源/目的與協定參數以建立透明轉發。</p>
        <div className="row">
          <Input placeholder="來源位址:埠" uiSize="sm" />
          <Input placeholder="目的位址:埠" uiSize="sm" />
          <Button className="btn--sm">建立轉發</Button>
        </div>
      </div>
    </div>
  )
}
