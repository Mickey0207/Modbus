import { get, post } from '@/api/shared/http'

export interface ListPortsResult {
  success: boolean
  data?: Array<{ path: string; manufacturer?: string }>
  message?: string
}

export interface CaptureParams {
  path: string
  baudRate: number
  dataBits: number
  stopBits: number
  parity: 'none' | 'even' | 'odd'
  durationMs: number
}

export interface CaptureResult {
  success: boolean
  data?: { hex: string; bytes: number }
  message?: string
}

export function listSerialPorts() {
  return get<ListPortsResult>('/api/serialspy/ports')
}

export function captureSerial(params: CaptureParams) {
  return post<CaptureResult>('/api/serialspy/capture', params)
}
