import React from 'react'
import { Button, Input } from '@/components/index'

export default function TcpIpPortScan() {
  return (
    <div className="col">
      <div className="card">
        <h3 className="m-0">TCP/IP 埠掃描</h3>
        <p className="text-muted">輸入目標位址與埠範圍進行掃描。</p>
        <div className="row">
          <Input placeholder="目標 IP 或網段 (例如 192.168.1.0/24)" uiSize="sm" />
          <Input placeholder="埠範圍 (例如 1-1024)" uiSize="sm" />
          <Button className="btn--sm">開始掃描</Button>
        </div>
      </div>
    </div>
  )
}
