import { get, post } from '@/api/shared/http'

export const pollStatuses = () => post<{ success: boolean }>(`/api/sites/status/poll`)
export const scanAllSlaves = () => post<{ success: boolean; data: any[] }>(`/api/slaves/scan`)
export const listSlavesByHost = (hostId: string) => get<{ success: boolean; data: Array<{
  unitId: number;
  name?: string;
  connected?: number;
  enabled?: number;
  type?: string;
  swMaskCurrent?: number | null;
  swOnCount?: number | null;
  dimMaskCurrent?: number | null;
  dimOnCount?: number | null;
  dimValuesCurrent?: number[] | null;
  updatedAt?: number;
}> }>(`/api/sites/status/slaves/by-host/${encodeURIComponent(hostId)}`)

// 控制：直接寫入 DB 並透過控制對映下發（由後端處理細節）
export const setSlaveEnabled = (hostId: string, unitId: number, enabled: boolean) =>
  post<{ success: boolean }>(`/api/sites/slaves/${encodeURIComponent(hostId)}/${unitId}/enabled`, { enabled })

export const setSlaveType = (hostId: string, unitId: number, type: 'SL-SW8CH' | 'SL-1-10V4CHDIM') =>
  post<{ success: boolean }>(`/api/sites/slaves/${encodeURIComponent(hostId)}/${unitId}/type`, { type })
