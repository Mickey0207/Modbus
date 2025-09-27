import { get, post } from '@/api/shared/http'

export type HostConfig = { id: string; ip: string; port: number; unitId: number }

export const listRegistry = () => get<{ success: boolean; data: HostConfig[] }>(`/api/registry`)
export const upsertHost = (payload: HostConfig) => post<{ success: boolean; message: string }>(`/api/registry`, payload)
export const deleteHost = (id: string) => fetch(`/api/registry/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => r.json())

export const connectAll = () => post<{ success: boolean; data: any[] }>(`/api/hosts/connect-all`)
export const disconnectAll = () => post<{ success: boolean; data: any[] }>(`/api/hosts/disconnect-all`)
