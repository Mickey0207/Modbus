import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listRegistry } from '@/api/hosts/registry'
import { getStatuses, connectHost, disconnectHost, type ConnectPayload } from '@/api/hosts/connections'

export type HostInfo = { id: string; ip?: string; port?: number; unitId?: number; connected: boolean }

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
      const [reg, stat] = await Promise.all([listRegistry(), getStatuses()])
      if (!reg?.success) throw new Error('讀取 registry 失敗')
      if (!stat?.success) throw new Error('讀取狀態失敗')
      const byId: Record<string, HostInfo> = {}
      for (const r of (reg.data || [])) byId[r.id] = { id: r.id, ip: r.ip, port: r.port, unitId: r.unitId, connected: false }
      for (const s of (stat.data || [])) byId[s.id] = { ...(byId[s.id] || { id: s.id }), ...s }
      const merged = Object.values(byId).sort((a,b)=> a.id.localeCompare(b.id))
      if (mounted.current) {
        // 僅在資料實質變更時才更新，避免輪詢造成的閃爍（最小化 re-render）
        const sameLength = hosts.length === merged.length
        const shallowEqual = sameLength && hosts.every((h, i) => {
          const m = merged[i]
          return h.id === m.id && h.ip === m.ip && h.port === m.port && h.unitId === m.unitId && h.connected === m.connected
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
