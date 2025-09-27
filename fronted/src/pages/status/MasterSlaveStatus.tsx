import React, { useEffect, useMemo, useState } from 'react'
import { Badge, Button, SmartTable, LightButton, Select, Input, InlineEditableCell, NumberInput } from '@/components/index'
import { IconLink, IconTrash } from '@/components/icons'
import useHosts from '@/hooks/useHosts'
import { upsertHost, deleteHost, type HostConfig } from '@/api/hosts/registry'

export default function MasterSlaveStatus() {
  const { hosts, loading, error, refresh, connect, disconnect } = useHosts({ pollMs: 2000 })
  const connectedCount = hosts.filter(h => h.connected).length
  const demoHost = { id: 'demo-1', ip: '192.168.1.10', port: 502, unitId: 1, connected: true }
  const shownHosts = useMemo(() => (hosts.length ? hosts : [demoHost as any]), [hosts])
  const [scanStamp, setScanStamp] = useState<Record<string, number>>({})

  const requestScan = (id: string) => setScanStamp(s => ({ ...s, [id]: (s[id] ?? 0) + 1 }))

  const commitHostField = async (row: any, field: 'id'|'ip'|'port'|'unitId', value: string | number) => {
    try {
      const payload: HostConfig = {
        id: field === 'id' ? String(value) : String(row.id),
        ip: field === 'ip' ? String(value) : String(row.ip ?? ''),
        port: field === 'port' ? Number(value) : Number(row.port ?? 502),
        unitId: field === 'unitId' ? Number(value) : Number(row.unitId ?? 1),
      }
      await upsertHost(payload)
      // 若為更名 id，嘗試移除舊 id 避免殘留
      if (field === 'id' && String(value) !== String(row.id)) {
        try { await deleteHost(String(row.id)) } catch {}
      }
      await refresh()
    } catch (e) {
      console.error('更新主機失敗', e)
    }
  }
  return (
    <div className="col">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 className="m-0">主 / 從 機狀態</h3>
          <div className="row">
            <Badge color="blue"><span className="mono">{connectedCount}/{hosts.length}</span> 已連線</Badge>
            <Button className="btn--sm btn--outline" onClick={()=>refresh()} disabled={loading}>重新整理</Button>
          </div>
        </div>
        {error && <div className="text-muted">{error}</div>}
        {hosts.length === 0 && (
          <div className="text-muted" style={{ marginTop: 6 }}>
            目前沒有主機資料，以下顯示一組示範主機，您可以展開查看三筆從機模擬資料。
          </div>
        )}
        <div style={{ paddingTop: 12 }}>
          <SmartTable
            columns={[
              { key: 'id', title: '主機 ID', sortable: true, className: 'mono', render: (v, r:any) => (
                <InlineEditableCell value={String(v ?? '')} onCommit={(val)=>commitHostField(r, 'id', val)} />
              ) },
              { key: 'ip', title: 'IP', sortable: true, className: 'mono', render: (v, r:any) => (
                <InlineEditableCell value={String(v ?? '')} onCommit={(val)=>commitHostField(r, 'ip', val)} />
              ) },
              { key: 'port', title: 'Port', sortable: true, className: 'mono', render: (v, r:any) => (
                <InlineEditableCell value={Number(v ?? 0)} type="number" onCommit={(val)=>commitHostField(r, 'port', Number(val))} />
              ) },
              { key: 'unitId', title: 'Unit ID', sortable: true, className: 'mono', render: (v, r:any) => (
                <InlineEditableCell value={Number(v ?? 0)} type="number" onCommit={(val)=>commitHostField(r, 'unitId', Number(val))} />
              ) },
              { key: 'connected', title: '狀態', sortable: true, render: (_v, h) => (h.connected ? <Badge color="green">已連線</Badge> : <Badge color="red">未連線</Badge>) },
            ]}
            data={shownHosts}
            rowKey={(h)=>h.id}
            renderActions={(h:any)=> (
              <div className="row" style={{ gap: 6 }}>
                <button className="icon-btn icon-only" title="連線" onClick={()=> connect({ id: h.id, ip: h.ip, port: h.port, unitId: h.unitId })}>
                  <IconLink />
                </button>
                <button className="icon-btn icon-only" title="斷線" onClick={()=> disconnect(h.id)}>
                  {/* 以斜線鏈結代表斷線 */}
                  <IconLink style={{ transform: 'rotate(45deg)', opacity: .85 }} />
                </button>
                <button className="icon-btn icon-only" title="搜尋從機" onClick={()=> requestScan(h.id)}>
                  {/* 使用眼睛圖示代表掃描/檢視 */}
                  {/* 若需更明確可於 icons.tsx 新增放大鏡圖示 */}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                </button>
                <button className="icon-btn icon-only" title="刪除" onClick={async()=> { await deleteHost(h.id); await refresh() }}>
                  <IconTrash />
                </button>
              </div>
            )}
            expandable={{
              expandedRowRender: (h) => (
                <SlaveSubtable hostId={h.id} baseAddr={h.unitId ?? 1} hostConnected={!!h.connected} scanStamp={scanStamp[h.id] ?? 0} />
              )
            }}
          />
        </div>
      </div>
    </div>
  )
}

type SlaveType = 'SL-SW8CH' | 'SL-1-10V4CHDIM'

type SlaveRow = {
  id: string
  addr: number
  type: SlaveType
  connected?: boolean
  sw?: boolean[]
  dim?: number[]
  // 記憶每個通道上次非 0 的值，切回亮起時恢復這個值
  dimMem?: number[]
}

function SlaveSubtable({ hostId, baseAddr, hostConnected, scanStamp }: { hostId: string; baseAddr: number; hostConnected: boolean; scanStamp: number }) {
  // 以 hostId 為 key 的本地儲存，讓展開/收合或返回頁面後仍能保留狀態
  const storageKey = `ms:slaveRows:${hostId}`
  // 模擬資料（初始值）；若 localStorage 有資料會覆蓋掉這些預設
  const [rows, setRows] = useState<SlaveRow[]>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed as SlaveRow[]
      }
    } catch {}
    return [
      { id: `${hostId}-s1`, addr: baseAddr, type: 'SL-SW8CH', connected: hostConnected, sw: [true, false, true, false, true, false, true, false] },
      { id: `${hostId}-s2`, addr: baseAddr + 1, type: 'SL-1-10V4CHDIM', connected: hostConnected, dim: [0, 64, 128, 255], dimMem: [255, 255, 255, 255] },
      { id: `${hostId}-s3`, addr: baseAddr + 2, type: 'SL-SW8CH', connected: hostConnected, sw: [false, true, false, true, false, true, false, true] },
    ]
  })

  // 任何變更即保存到 localStorage
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(rows)) } catch {}
  }, [rows, storageKey])

  // 當觸發『搜尋從機』時，模擬更新從機連線狀態
  useEffect(() => {
    if (!scanStamp) return
    setRows(prev => prev.map(r => ({ ...r, connected: Math.random() > 0.25 })))
  }, [scanStamp])

  // DIM 類型改為右側小欄位直接輸入

  const handleTypeChange = (rid: string, next: SlaveType) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rid) return r
      if (next === 'SL-SW8CH') return { id: r.id, addr: r.addr, type: next, sw: Array(8).fill(false) }
      return { id: r.id, addr: r.addr, type: next, dim: [0, 0, 0, 0], dimMem: [255, 255, 255, 255] }
    }))
  }

  const toggleSw = (rid: string, idx: number, on: boolean) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rid || r.type !== 'SL-SW8CH' || !r.sw) return r
      const sw = r.sw.slice(); sw[idx] = on
      return { ...r, sw }
    }))
  }

  const setDimVal = (rid: string, idx: number, value: number) => {
    const v = Math.max(0, Math.min(255, Math.round(value)))
    setRows(prev => prev.map(r => {
      if (r.id !== rid || r.type !== 'SL-1-10V4CHDIM' || !r.dim) return r
      const dim = r.dim.slice(); dim[idx] = v
      const dimMem = (r.dimMem ? r.dimMem.slice() : Array(dim.length).fill(255))
      if (v > 0) dimMem[idx] = v
      return { ...r, dim, dimMem }
    }))
  }

  const toggleDim = (rid: string, idx: number) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rid || r.type !== 'SL-1-10V4CHDIM' || !r.dim) return r
      const dim = r.dim.slice()
      const dimMem = (r.dimMem ? r.dimMem.slice() : Array(dim.length).fill(255))
      const cur = dim[idx] ?? 0
      if (cur > 0) {
        // 亮 -> 滅：保留記憶值，將當前設 0
        dim[idx] = 0
      } else {
        // 滅 -> 亮：恢復記憶值（若無則 255）
        dim[idx] = dimMem[idx] ?? 255
      }
      return { ...r, dim, dimMem }
    }))
  }

  const columns = useMemo(() => ([
    { key: 'id', title: 'ID', sortable: true, className: 'mono', render: (v:any, r:SlaveRow, idx:number) => (
      <InlineEditableCell value={String(v ?? '')} onCommit={(val)=> setRows(prev => prev.map(x => x.id === r.id ? { ...x, id: String(val) } : x))} />
    ) },
    { key: 'addr', title: '站號', sortable: true, className: 'mono', render: (v:any, r:SlaveRow) => (
      <InlineEditableCell value={Number(v ?? 0)} type="number" onCommit={(val)=> setRows(prev => prev.map(x => x.id === r.id ? { ...x, addr: Number(val) } : x))} />
    ) },
    { key: 'connected', title: '狀態', sortable: false, render: (_:any, r:SlaveRow) => (
      r.connected ? <Badge color="green">已連線</Badge> : <Badge color="red">未連線</Badge>
    ) },
    { key: 'type', title: '從機類型', sortable: false, render: (_: any, r: SlaveRow) => (
      <Select
        size="sm"
        value={r.type}
        onChange={(v)=>handleTypeChange(r.id, v as SlaveType)}
        options={[
          { label: 'SL-SW8CH', value: 'SL-SW8CH' },
          { label: 'SL-1-10V4CHDIM', value: 'SL-1-10V4CHDIM' },
        ]}
      />
    ) },
  ]), [])

  return (
    <div>
      <div className="text-muted">從機資訊（可選擇類型：SL-SW8CH 或 SL-1-10V4CHDIM）</div>
      <div style={{ paddingTop: 8 }}>
        <SmartTable
          columns={columns as any}
          data={rows as any}
          rowKey={(r: any)=>r.id}
          actionsClassName="lights"
          renderActions={(row: SlaveRow) => (
            <>
              {row.type === 'SL-SW8CH' && (
                <div className="light-group">
                  {(row.sw ?? Array(8).fill(false)).map((on, i) => (
                    <LightButton key={i} size="sm" on={on} title={`CH${i+1}`} onChange={(v)=>toggleSw(row.id, i, v)} />
                  ))}
                </div>
              )}
              {row.type === 'SL-1-10V4CHDIM' && (
                <div className="dim-group">
                  {(row.dim ?? [0,0,0,0]).map((val, i) => {
                    const on = (val ?? 0) > 0
                    return (
                      <div className="dim-pair" key={i}>
                        <LightButton
                          size="sm"
                          on={on}
                          title={`通道 ${i+1}`}
                          onClick={() => toggleDim(row.id, i)}
                        />
                        <NumberInput
                          className="dim-input"
                          value={val}
                          min={0}
                          max={255}
                          step={1}
                          onChange={(n)=> setDimVal(row.id, i, n)}
                          size="sm"
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        />
      </div>
    </div>
  )
}
