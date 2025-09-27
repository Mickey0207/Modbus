import { post } from '@/api/shared/http'

export interface PortScanParams {
  ip: string
  start: number
  end: number
  timeoutMs: number
  concurrency: number
}

export interface PortScanResult {
  success: boolean
  message?: string
  data?: { open: number[]; elapsed: number }
}

export async function runPortScan(params: PortScanParams): Promise<PortScanResult> {
  // 假設伺服器端提供 /api/portscan/run
  return post<PortScanResult>('/api/portscan/run', params)
}
