import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listRegistry } from '@/api/hosts/registry'
import * as SitesApi from '@/api/sites/service'
import { getStatuses, connectHost, disconnectHost, type ConnectPayload } from '@/api/hosts/connections'

export type HostInfo = { id: string; name?: string; ip?: string; port?: number; unitId?: number; connected: boolean }

export function useHosts(opts?: { pollMs?: number }) {
  const pollMs = opts?.pollMs ?? 0
  const [hosts, setHosts] = useState<HostInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async (opt?: { silent?: boolean }) => {
    const silent = !!opt?.silent
    if (!silent) setError(null)
    if (!silent) setLoading(true)
    try {
      const [reg, stat, sites] = await Promise.all([listRegistry(), getStatuses(), SitesApi.listSites().catch(()=>({ data: [] as any[] }))])
      if (!reg?.success) throw new Error('讀取 registry 失敗')
      if (!stat?.success) throw new Error('讀取狀態失敗')
      const byId: Record<string, HostInfo> = {}
      // 以 registry 為主，只顯示資料表中存在的主機
      for (const r of (reg.data || [])) byId[r.id] = { id: r.id, ip: r.ip, port: r.port, unitId: r.unitId, connected: false }
      // 僅合併對應的狀態；不新增未知主機，避免 UI 自動生成未在資料表中的主機
      for (const s of (stat.data || [])) {
        if (byId[s.id]) byId[s.id] = { ...byId[s.id], ...s }
      }
      // 併入 DB 的 connected 與 name（若有），以 DB 為準
      try {
        const list = (sites as any)?.data || (Array.isArray(sites) ? sites : [])
        for (const site of list) {
          const hosts = site?.hosts || []
          for (const h of hosts) {
            const id = h?.id
            if (id && byId[id]) byId[id] = { ...byId[id], connected: !!h.connected, name: String(h.name || '') }
          }
        }
      } catch {}
      const merged = Object.values(byId).sort((a,b)=> a.id.localeCompare(b.id))
      if (mounted.current) {
        // 僅在資料實質變更時才更新，避免輪詢造成的閃爍（最小化 re-render）
        const sameLength = hosts.length === merged.length
        const shallowEqual = sameLength && hosts.every((h, i) => {
          const m = merged[i]
          return h.id === m.id && h.name === m.name && h.ip === m.ip && h.port === m.port && h.unitId === m.unitId && h.connected === m.connected
        })
        if (!shallowEqual) setHosts(merged)
      }
    } catch (e: any) {
      if (mounted.current && !silent) setError(e?.message || String(e))
    } finally {
      if (mounted.current && !silent) setLoading(false)
    }
  }, [hosts])

  useEffect(() => { mounted.current = true; refresh(); return () => { mounted.current = false } }, [refresh])
  useEffect(() => { if (!pollMs) return; const t = setInterval(() => { refresh({ silent: true }) }, pollMs); return () => clearInterval(t) }, [pollMs, refresh])

  const connect = useCallback(async (p: ConnectPayload) => { await connectHost(p); await refresh({ silent: true }) }, [refresh])
  const disconnect = useCallback(async (id: string) => { await disconnectHost(id); await refresh({ silent: true }) }, [refresh])

  const value = useMemo(() => ({ hosts, loading, error, refresh, connect, disconnect }), [hosts, loading, error, refresh, connect, disconnect])
  return value
}

export default useHosts
