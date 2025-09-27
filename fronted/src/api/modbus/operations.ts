import { post } from '@/api/shared/http'

export const readHoldingRegisters = (id: string, address: number, length: number) =>
  post<{ success: boolean; data: number[] }>(`/api/hosts/${encodeURIComponent(id)}/read/holding-registers`, { address, length, len: length, count: length, quantity: length })

export const writeSingleRegister = (id: string, address: number, value: number) =>
  post<{ success: boolean; message: string }>(`/api/hosts/${encodeURIComponent(id)}/write/single-register`, { address, value })
