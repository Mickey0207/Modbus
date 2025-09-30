import { useEffect, useRef, useState } from 'react'
import { __getHosts, upsertHost } from '@/api/hosts/registry'

export type HostState = {
  id: string
  name?: string
  ip?: string
  port?: number
  unitId?: number
  connected: boolean
}

type ConnectPayload = { id: string; ip?: string; port?: number; unitId?: number }

export default function useHosts(options: { pollMs?: number } = {}) {
  const { pollMs = 0 } = options
  const [hosts, setHosts] = useState<HostState[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const sync = () => {
    const list = __getHosts()
    setHosts(prev => {
      const byId = new Map(prev.map(h => [h.id, h]))
      const next: HostState[] = []
      for (const h of list) {
        const old = byId.get(h.id)
        next.push({ id: h.id, name: h.name, ip: h.ip, port: h.port, unitId: h.unitId, connected: old?.connected ?? false })
      }
      return next
    })
  }

  const refresh = async (_opts?: { silent?: boolean }) => {
    if (!_opts?.silent) setLoading(true)
    try { sync() } catch (e: any) { setError(e?.message || String(e)) }
    finally { if (!_opts?.silent) setLoading(false) }
  }

  useEffect(() => {
    refresh()
    if (pollMs > 0) {
      timer.current = window.setInterval(() => refresh({ silent: true }), pollMs)
      return () => { if (timer.current) window.clearInterval(timer.current) }
    }
    return () => {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs])

  const connect = async (p: ConnectPayload) => {
    await upsertHost({ id: p.id, ip: p.ip, port: p.port, unitId: p.unitId })
    setHosts(list => list.map(h => h.id === p.id ? { ...h, connected: true } : h))
  }

  const disconnect = async (id: string) => {
    setHosts(list => list.map(h => h.id === id ? { ...h, connected: false } : h))
  }

  return { hosts, loading, error, refresh, connect, disconnect }
}
