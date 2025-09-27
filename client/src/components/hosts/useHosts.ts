import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listRegistry } from '../../api/hosts/registry'
import { getStatuses } from '../../api/hosts/connections'

export type HostInfo = { id: string; ip?: string; port?: number; unitId?: number; connected: boolean }

export function useHosts(opts?: { pollMs?: number }) {
  const pollMs = opts?.pollMs ?? 0
  const [hosts, setHosts] = useState<HostInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
  const [reg, stat] = await Promise.all([listRegistry(), getStatuses()])
  if (!reg?.success) throw new Error('讀取 registry 失敗')
  if (!stat?.success) throw new Error('讀取狀態失敗')
      const byId: Record<string, HostInfo> = {}
      for (const r of (reg.data || [])) {
        byId[r.id] = { id: r.id, ip: r.ip, port: r.port, unitId: r.unitId, connected: false }
      }
      for (const s of (stat.data || [])) {
        const prev = byId[s.id] || { id: s.id } as HostInfo
        byId[s.id] = { ...prev, ...s }
      }
      const merged = Object.values(byId)
      if (mounted.current) setHosts(merged)
    } catch (e: any) {
      if (mounted.current) setError(e?.message || String(e))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    refresh()
    return () => { mounted.current = false }
  }, [refresh])

  useEffect(() => {
    if (!pollMs || pollMs <= 0) return
    const t = setInterval(refresh, pollMs)
    return () => clearInterval(t)
  }, [pollMs, refresh])

  const value = useMemo(() => ({ hosts, loading, error, refresh }), [hosts, loading, error, refresh])
  return value
}

export default useHosts
