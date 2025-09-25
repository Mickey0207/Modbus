import { get, post } from '../../lib/api'

export interface ConnectPayload { id: string; ip: string; port: number; unitId: number }

export const getStatuses = () => get<{ success: boolean; data: any[] }>(`/api/hosts/status`)
export const connectHost = (payload: ConnectPayload) => post(`/api/hosts/connect`, payload)
export const disconnectHost = (id: string) => post(`/api/hosts/disconnect`, { id })
export const readHoldingRegisters = (id: string, address: number, length: number) =>
  post<{ success: boolean; data: number[] }>(`/api/hosts/${encodeURIComponent(id)}/read/holding-registers`, { address, length })
export const writeSingleRegister = (id: string, address: number, value: number) =>
  post<{ success: boolean; message: string }>(`/api/hosts/${encodeURIComponent(id)}/write/single-register`, { address, value })
