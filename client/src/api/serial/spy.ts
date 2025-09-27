import { get, post } from '../shared/http'

export function listSerialPorts() {
  return get<{ success: boolean; data: any[] }>('/api/serialspy/list')
}

export function captureSerial(params: { path: string; baudRate?: number; dataBits?: number; stopBits?: number; parity?: 'none' | 'even' | 'odd'; durationMs?: number }) {
  return post<{ success: boolean; data?: { bytes: number; hex: string } }>(
    '/api/serialspy/capture', params
  )
}
