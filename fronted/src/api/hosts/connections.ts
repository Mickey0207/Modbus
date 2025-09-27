import { get, post } from '@/api/shared/http'

export interface ConnectPayload { id: string; ip: string; port: number; unitId: number }

export const getStatuses = () => get<{ success: boolean; data: any[] }>(`/api/hosts/status`)
export const connectHost = (payload: ConnectPayload) => post(`/api/hosts/connect`, payload)
export const disconnectHost = (id: string) => post(`/api/hosts/disconnect`, { id })
