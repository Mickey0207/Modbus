import { post } from '@/api/shared/http'

export const readHoldingRegisters = (id: string, address: number, length: number) =>
  post<{ success: boolean; data: number[] }>(`/api/hosts/${encodeURIComponent(id)}/read/holding-registers`, { address, length, len: length, count: length, quantity: length })

export const writeSingleRegister = (id: string, address: number, value: number) =>
  post<{ success: boolean; message: string }>(`/api/hosts/${encodeURIComponent(id)}/write/single-register`, { address, value })

// High-level helper to write or enqueue when offline
import { enqueue } from './queue'
export async function writeOrQueue(hostId: string, address: number, value: number, isConnected: ()=>boolean) {
  if (isConnected()) {
    const r = await writeSingleRegister(hostId, address, value)
    return !!r?.success
  }
  enqueue({ hostId, address, value, ts: Date.now() })
  return true
}
