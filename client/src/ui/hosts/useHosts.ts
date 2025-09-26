import { useEffect, useRef, useState } from 'react'
import { get } from '../../api/shared/http'

export interface HostStatus { id: string; ip?: string; port?: number; unitId?: number; connected: boolean }

// 可選的 options，支援輪詢以即時更新主機連線狀態
export function useHosts(options?: { pollMs?: number }) {
  const [hosts, setHosts] = useState<HostStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)

  async function refresh() {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      setLoading(true)
      setError(null)
      const res = await get<{ success: boolean; data: HostStatus[] }>('/api/hosts/status')
      if (!res.success) throw new Error('取得狀態失敗')
      setHosts(res.data)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    // 立即讀取一次
    refresh()
    // 監聽主機狀態異動事件，立即刷新（由 HostsManager 發出）
    const onChanged = () => { refresh() }
    window.addEventListener('hosts:changed', onChanged as any)
    // 啟用輪詢（若指定）
    if (options?.pollMs && options.pollMs > 0) {
      const id = window.setInterval(refresh, options.pollMs)
      timerRef.current = id
      return () => {
        window.removeEventListener('hosts:changed', onChanged as any)
        if (timerRef.current) window.clearInterval(timerRef.current)
      }
    }
    return () => { window.removeEventListener('hosts:changed', onChanged as any) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.pollMs])

  return { hosts, loading, error, refresh }
}