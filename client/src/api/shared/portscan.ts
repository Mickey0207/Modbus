import { post } from './http'

export interface PortScanParams {
  ip: string
  start?: number
  end?: number
  ports?: number[]
  timeoutMs?: number
  concurrency?: number
}

export interface PortScanResult {
  success: boolean
  data?: { open: number[]; count: number; elapsed: number }
  message?: string
}

export function runPortScan(params: PortScanParams) {
  return post<PortScanResult>('/api/portscan/run', params)
}
